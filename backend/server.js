const app = require("express")();

const server = require("http").createServer(app);

const io = require('socket.io')(server, {
    cors: {
        origin: true,
    },
});

io.on("connection", (socket)=>{
    socket.on("join-room", ({ roomCode }) => {
        if (typeof roomCode !== "string" || !roomCode.trim()) return;
        socket.join(roomCode);
    });

    socket.on("chat-message", ({ roomCode, displayName, message }) => {
        if (
            typeof roomCode !== "string" ||
            typeof displayName !== "string" ||
            typeof message !== "string" ||
            !roomCode.trim() ||
            !displayName.trim() ||
            !message.trim()
        ) return;

        io.to(roomCode).emit("chat-message", {
            displayName: displayName.trim(),
            message: message.trim(),
            timestamp: Date.now(),
        });
    })
})

server.listen(5000, ()=> console.log("Server started on port 5000"));