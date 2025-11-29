// ==========================================
// socket.js — Simple Socket.IO Wrapper
// ==========================================

let io = null;

// Initialize Socket.IO
function initSocket(server) {
    const { Server } = require("socket.io");

    io = new Server(server, {
        cors: { origin: "*" }
    });

    io.on("connection", (socket) => {
        console.log("Web dashboard connected:", socket.id);
        socket.emit("log", "--- Connected to Live Log Stream ---");
    });

    return io;
}

// Getter used by other modules
function getIO() {
    if (!io) {
        throw new Error("Socket.IO not initialized yet!");
    }
    return io;
}

module.exports = {
    initSocket,
    getIO
};
