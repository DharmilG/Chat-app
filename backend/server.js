const app = require("express")();
const crypto = require("crypto");

const server = require("http").createServer(app);

const io = require('socket.io')(server, {
    cors: {
        origin: true,
    },
});

const roomMessages = new Map();
const activeUsers = new Map();
const pendingInvitations = new Map();
const privateRooms = new Map();
const invitationLifetimeMs = 60 * 1000;

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

io.on("connection", (socket)=>{
    socket.on("discover-user", ({ displayName, discoverable = true }) => {
        if (
            typeof displayName !== "string" ||
            typeof discoverable !== "boolean" ||
            !displayName.trim()
        ) return;

        socket.data.displayName = displayName.trim();
        socket.data.discoverable = discoverable;
        activeUsers.set(socket.id, {
            id: socket.id,
            displayName: socket.data.displayName,
            roomCode: socket.data.roomCode || null,
            discoverable,
        });
        broadcastDiscoverableUsers();
    });

    socket.on("private-chat-request", ({ recipientId }, acknowledge) => {
        const sender = activeUsers.get(socket.id);
        const recipient = activeUsers.get(recipientId);
        if (
            !sender ||
            !recipient ||
            sender.id === recipient.id ||
            !recipient.discoverable ||
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

    socket.on("join-room", ({ roomCode, displayName, privateAccessToken }, acknowledge) => {
        if (
            typeof roomCode !== "string" ||
            typeof displayName !== "string" ||
            !roomCode.trim() ||
            !displayName.trim()
        ) {
            acknowledge?.({ ok: false, error: "Room code and display name are required." });
            return;
        }

        const normalizedRoomCode = roomCode.trim();
        const privateParticipants = privateRooms.get(normalizedRoomCode);
        const expectedName = privateParticipants?.accessTokens.get(privateAccessToken);
        if (privateParticipants && expectedName !== displayName.trim()) {
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
        socket.data.displayName = displayName.trim();
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
        acknowledge?.({ ok: true });
    });

    socket.on("private-chat-accept", ({ invitationId }, acknowledge) => {
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

    socket.on("private-chat-decline", ({ invitationId }, acknowledge) => {
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

    socket.on("chat-message", ({ roomCode, displayName, message }, acknowledge) => {
        if (
            typeof roomCode !== "string" ||
            typeof displayName !== "string" ||
            typeof message !== "string" ||
            !roomCode.trim() ||
            !displayName.trim() ||
            !message.trim()
        ) return;

        const normalizedRoomCode = roomCode.trim();
        if (socket.data.roomCode !== normalizedRoomCode) return;

        const chatMessage = {
            senderId: socket.id,
            displayName: socket.data.displayName,
            message: message.trim(),
            timestamp: Date.now(),
        };
        const messages = roomMessages.get(normalizedRoomCode) || [];
        messages.push(chatMessage);
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
        for (const [privateRoomCode, privateRoom] of privateRooms) {
            privateRoom.connected.delete(socket.id);
            if (!privateRoom.connected.size && !privateRoom.accessTokens.size) {
                privateRooms.delete(privateRoomCode);
            }
        }
        if (roomCode) {
            removeRoomMessagesWhenEmpty(roomCode);
            broadcastRoomUsers(roomCode);
        }
        broadcastDiscoverableUsers();
    });
})

server.listen(5000, ()=> console.log("Server started on port 5000"));