const app = require("express")();
const crypto = require("crypto");
const host = process.env.HOST || "0.0.0.0";
const lanOnly = process.env.LAN_ONLY === "true";
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : true;
const maxSocketPayload = 256 * 1024;

const server = require("http").createServer(app);

const io = require('socket.io')(server, {
    cors: {
        origin: allowedOrigins,
    },
    maxHttpBufferSize: maxSocketPayload,
});

const roomMessages = new Map();
const activeUsers = new Map();
const pendingInvitations = new Map();
const privateRooms = new Map();
const invitationLifetimeMs = 60 * 1000;
const privateRoomLifetimeMs = 10 * 60 * 1000;
const maxDisplayNameLength = 32;
const maxRoomCodeLength = 32;
const maxMessageLength = 2000;
const maxMessagesPerRoom = 100;
const maxSignalDescriptionLength = 200000;
const maxIceCandidateLength = 2000;
const invitationWindowMs = 60 * 1000;
const maxInvitationsPerWindow = 5;

function normalizedText(value, maxLength) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text && text.length <= maxLength ? text : null;
}

function isRateLimited(socket) {
    const now = Date.now();
    const timestamps = (socket.data.invitationTimestamps || [])
        .filter((timestamp) => now - timestamp < invitationWindowMs);
    if (timestamps.length >= maxInvitationsPerWindow) {
        socket.data.invitationTimestamps = timestamps;
        return true;
    }
    timestamps.push(now);
    socket.data.invitationTimestamps = timestamps;
    return false;
}

function removeRoomMessagesWhenEmpty(roomCode) {
    const room = io.sockets.adapter.rooms.get(roomCode);
    if (!room || room.size === 0) {
        roomMessages.delete(roomCode);
    }
}

function broadcastRoomUsers(roomCode) {
    const users = [...activeUsers.values()]
        .filter((user) => user.roomCode === roomCode)
        .map(({ id, displayName }) => ({ id, displayName }));

    io.to(roomCode).emit("room-users", users);
}

function broadcastDiscoverableUsers() {
    const users = [...activeUsers.values()]
        .filter((user) => user.discoverable)
        .map(({ id, displayName }) => ({ id, displayName }));

    io.emit("online-users", users);
}

function createPrivateRoomCode() {
    let roomCode;
    do {
        roomCode = crypto.randomBytes(4).toString("hex").toUpperCase();
    } while (privateRooms.has(roomCode));
    return roomCode;
}

function createPrivateRoomAccessToken() {
    return crypto.randomBytes(16).toString("hex");
}

function cleanupPrivateRoom(roomCode) {
    const privateRoom = privateRooms.get(roomCode);
    if (!privateRoom) return;
    if (privateRoom.connected.size === 0 && privateRoom.accessTokens.size === 0) {
        privateRooms.delete(roomCode);
        roomMessages.delete(roomCode);
    }
}

function expireInvitation(invitationId) {
    const invitation = pendingInvitations.get(invitationId);
    if (!invitation) return;

    pendingInvitations.delete(invitationId);
    const sender = io.sockets.sockets.get(invitation.senderId);
    const recipient = io.sockets.sockets.get(invitation.recipientId);
    [sender, recipient].forEach((client) => {
        client?.emit("private-invitation-expired", {
            invitationId,
            recipientId: invitation.recipientId,
        });
    });
}

function relayWebRtcSignal(socket, eventName, payload) {
    const roomCode = socket.data.roomCode;
    const privateRoom = roomCode && privateRooms.get(roomCode);
    if (!socket.data.isPrivateRoom || !privateRoom || !payload) return;

    socket.to(roomCode).emit(eventName, {
        from: socket.id,
        ...payload,
    });
}

io.on("connection", (socket)=>{
    socket.emit("server-mode", {
        lanOnly,
        signaling: "local-socket",
    });

    socket.on("discover-user", ({ displayName, discoverable = true } = {}) => {
        const normalizedDisplayName = normalizedText(displayName, maxDisplayNameLength);
        if (!normalizedDisplayName || typeof discoverable !== "boolean") return;

        socket.data.displayName = normalizedDisplayName;
        socket.data.discoverable = discoverable;
        activeUsers.set(socket.id, {
            id: socket.id,
            displayName: socket.data.displayName,
            roomCode: socket.data.roomCode || null,
            discoverable,
        });
        broadcastDiscoverableUsers();
    });

    socket.on("private-chat-request", ({ recipientId } = {}, acknowledge) => {
        const sender = activeUsers.get(socket.id);
        const recipient = activeUsers.get(recipientId);
        if (
            !sender ||
            !recipient ||
            sender.id === recipient.id ||
            !recipient.discoverable ||
            isRateLimited(socket) ||
            pendingInvitations.values().some(
                (invitation) =>
                    invitation.senderId === socket.id &&
                    invitation.recipientId === recipientId,
            )
        ) {
            acknowledge?.({ ok: false, error: "This user is not available." });
            return;
        }

        const invitation = {
            id: crypto.randomBytes(8).toString("hex"),
            senderId: socket.id,
            recipientId,
            senderName: sender.displayName,
            recipientName: recipient.displayName,
            expiresAt: Date.now() + invitationLifetimeMs,
        };
        pendingInvitations.set(invitation.id, invitation);
        setTimeout(() => expireInvitation(invitation.id), invitationLifetimeMs);

        io.to(recipientId).emit("private-invitation", {
            invitationId: invitation.id,
            sender: { id: sender.id, displayName: sender.displayName },
            expiresAt: invitation.expiresAt,
        });
        acknowledge?.({ ok: true, invitationId: invitation.id });
    });

    socket.on("join-room", ({ roomCode, displayName, privateAccessToken } = {}, acknowledge) => {
        const normalizedRoomCode = normalizedText(roomCode, maxRoomCodeLength);
        const normalizedDisplayName = normalizedText(displayName, maxDisplayNameLength);
        if (!normalizedRoomCode || !normalizedDisplayName) {
            acknowledge?.({ ok: false, error: "Room code and display name are required." });
            return;
        }

        const privateParticipants = privateRooms.get(normalizedRoomCode);
        const expectedName = privateParticipants?.accessTokens.get(privateAccessToken);
        if (privateParticipants && expectedName !== normalizedDisplayName) {
            acknowledge?.({ ok: false, error: "You are not invited to this private room." });
            return;
        }

        const previousRoomCode = socket.data.roomCode;
        if (previousRoomCode) {
            socket.leave(previousRoomCode);
            removeRoomMessagesWhenEmpty(previousRoomCode);
            broadcastRoomUsers(previousRoomCode);
        }

        socket.data.roomCode = normalizedRoomCode;
        socket.data.displayName = normalizedDisplayName;
        socket.data.isPrivateRoom = Boolean(privateParticipants);
        activeUsers.set(socket.id, {
            id: socket.id,
            displayName: socket.data.displayName,
            roomCode: socket.data.roomCode,
            discoverable: false,
        });
        socket.join(socket.data.roomCode);
        if (!roomMessages.has(socket.data.roomCode)) {
            roomMessages.set(socket.data.roomCode, []);
        }
        broadcastRoomUsers(socket.data.roomCode);
        broadcastDiscoverableUsers();
        if (privateParticipants) {
            privateParticipants.accessTokens.delete(privateAccessToken);
            privateParticipants.connected.add(socket.id);
        }
        acknowledge?.({
            ok: true,
            isPrivateRoom: socket.data.isPrivateRoom,
            lanOnly,
        });
    });

    socket.on("webrtc-offer", ({ description } = {}) => {
        if (
            description?.type !== "offer" ||
            typeof description.sdp !== "string" ||
            description.sdp.length > maxSignalDescriptionLength
        ) return;
        relayWebRtcSignal(socket, "webrtc-offer", { description });
    });

    socket.on("webrtc-answer", ({ description } = {}) => {
        if (
            description?.type !== "answer" ||
            typeof description.sdp !== "string" ||
            description.sdp.length > maxSignalDescriptionLength
        ) return;
        relayWebRtcSignal(socket, "webrtc-answer", { description });
    });

    socket.on("webrtc-ice-candidate", ({ candidate } = {}) => {
        if (
            !candidate ||
            typeof candidate.candidate !== "string" ||
            candidate.candidate.length > maxIceCandidateLength
        ) return;
        relayWebRtcSignal(socket, "webrtc-ice-candidate", { candidate });
    });

    socket.on("private-chat-accept", ({ invitationId } = {}, acknowledge) => {
        const invitation = pendingInvitations.get(invitationId);
        if (!invitation || invitation.recipientId !== socket.id) {
            acknowledge?.({ ok: false, error: "This invitation is no longer available." });
            return;
        }

        pendingInvitations.delete(invitationId);
        const roomCode = createPrivateRoomCode();
        const senderAccessToken = createPrivateRoomAccessToken();
        const recipientAccessToken = createPrivateRoomAccessToken();
        privateRooms.set(roomCode, {
            accessTokens: new Map([
                [senderAccessToken, invitation.senderName],
                [recipientAccessToken, invitation.recipientName],
            ]),
            connected: new Set(),
        });
        setTimeout(() => {
            privateRooms.delete(roomCode);
            roomMessages.delete(roomCode);
        }, privateRoomLifetimeMs);
        const sender = io.sockets.sockets.get(invitation.senderId);
        const recipient = io.sockets.sockets.get(invitation.recipientId);
        const event = {
            roomCode,
            otherUser: {
                id: invitation.recipientId,
                displayName: invitation.recipientName,
            },
        };
        sender?.emit("private-chat-accepted", {
            ...event,
            privateAccessToken: senderAccessToken,
            otherUser: {
                id: invitation.recipientId,
                displayName: invitation.recipientName,
            },
        });
        recipient?.emit("private-chat-accepted", {
            ...event,
            privateAccessToken: recipientAccessToken,
            otherUser: {
                id: invitation.senderId,
                displayName: invitation.senderName,
            },
        });
        acknowledge?.({ ok: true, roomCode });
    });

    socket.on("private-chat-decline", ({ invitationId } = {}, acknowledge) => {
        const invitation = pendingInvitations.get(invitationId);
        if (!invitation || invitation.recipientId !== socket.id) {
            acknowledge?.({ ok: false, error: "This invitation is no longer available." });
            return;
        }

        pendingInvitations.delete(invitationId);
        io.to(invitation.senderId).emit("private-invitation-declined", {
            invitationId,
            recipientId: invitation.recipientId,
        });
        acknowledge?.({ ok: true });
    });

    socket.on("chat-message", ({ roomCode, displayName, message } = {}, acknowledge) => {
        if (socket.data.isPrivateRoom) {
            acknowledge?.({
                ok: false,
                error: "Private room messages must use the direct connection.",
            });
            return;
        }
        const normalizedRoomCode = normalizedText(roomCode, maxRoomCodeLength);
        const normalizedMessage = normalizedText(message, maxMessageLength);
        if (!normalizedRoomCode || !normalizedMessage) {
            acknowledge?.({ ok: false, error: "Message is invalid or too long." });
            return;
        }

        if (socket.data.roomCode !== normalizedRoomCode) return;

        const chatMessage = {
            senderId: socket.id,
            displayName: socket.data.displayName,
            message: normalizedMessage,
            timestamp: Date.now(),
        };
        const messages = roomMessages.get(normalizedRoomCode) || [];
        messages.push(chatMessage);
        if (messages.length > maxMessagesPerRoom) {
            messages.splice(0, messages.length - maxMessagesPerRoom);
        }
        roomMessages.set(normalizedRoomCode, messages);
        socket.to(normalizedRoomCode).emit("chat-message", chatMessage);
        if (typeof acknowledge === "function") {
            acknowledge(chatMessage);
        }
    })

    socket.on("disconnect", () => {
        const roomCode = socket.data.roomCode;
        for (const [invitationId, invitation] of pendingInvitations) {
            if (invitation.senderId === socket.id || invitation.recipientId === socket.id) {
                pendingInvitations.delete(invitationId);
                const otherSocketId = invitation.senderId === socket.id
                    ? invitation.recipientId
                    : invitation.senderId;
                io.to(otherSocketId).emit("private-invitation-expired", {
                    invitationId,
                    recipientId: invitation.recipientId,
                });
            }
        }
        activeUsers.delete(socket.id);
        socket.data.isPrivateRoom = false;
        for (const [privateRoomCode, privateRoom] of privateRooms) {
            privateRoom.connected.delete(socket.id);
            cleanupPrivateRoom(privateRoomCode);
        }
        if (roomCode) {
            removeRoomMessagesWhenEmpty(roomCode);
            broadcastRoomUsers(roomCode);
        }
        broadcastDiscoverableUsers();
    });
})

server.listen(5000, host, ()=> {
    console.log(`Server started on ${host}:5000 (${lanOnly ? "LAN-only" : "automatic"} mode)`);
});