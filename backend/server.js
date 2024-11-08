const app = require("express")();

const server = require("http").createServer(app);

const io = require('socket.io')(server);

io.on("connection", (socket)=>{
    console.log("SOcket: ", socket);

    socket.on("chat", (payload) => {
        console.log("Payload", payload)
        io.emit("chat", payload);
    })
})

server.listen(5000, ()=> console.log("Server started on port 5000"));