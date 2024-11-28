const app = require("express")();

const server = require("http").createServer(app);

const io = require('socket.io')(server, {
    cors: {
        origin: true,
    },
});

const roomMessages = new Map();
const activeUsers = new Map();

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

    socket.on("join-room", ({ roomCode, displayName }) => {
        if (
            typeof roomCode !== "string" ||
            typeof displayName !== "string" ||
            !roomCode.trim() ||
            !displayName.trim()
        ) return;

        const previousRoomCode = socket.data.roomCode;
        if (previousRoomCode) {
            socket.leave(previousRoomCode);
            removeRoomMessagesWhenEmpty(previousRoomCode);
            broadcastRoomUsers(previousRoomCode);
        }

        socket.data.roomCode = roomCode.trim();
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
        activeUsers.delete(socket.id);
        if (roomCode) {
            removeRoomMessagesWhenEmpty(roomCode);
            broadcastRoomUsers(roomCode);
        }
        broadcastDiscoverableUsers();
    });
})

server.listen(5000, ()=> console.log("Server started on port 5000"));