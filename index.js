// ==========================================
// index.js — Main Application Entry Point
// ==========================================
require("dotenv").config();

const http = require("http");
const express = require("express");
const { createServer: createDashboardServer } = require("./server");
const { scheduleStatusCheck, runStatusCheckJob } = require("./statusJob");
const { getSettings } = require("./settings");
const { initSocket } = require("./socket");

// Connect DB immediately
require("./db");

const PORT = process.env.PORT || 3000;

// Express wrapper (used by server.js + socket.io)
const app = express();
const server = http.createServer(app);

// Attach Socket.IO
initSocket(server);

// Serve API + Static Files
createDashboardServer(app, scheduleStatusCheck);

// Load settings & schedule cron
const settings = getSettings();
scheduleStatusCheck(settings.frequencyMinutes);

// Optional: run once immediately on boot
if (process.env.RUN_STATUS_CHECK === "true") {
    runStatusCheckJob().catch(err => console.error("Startup check error:", err));
}

// Start listening
server.listen(PORT, () => {
    console.log(`M3U Web Panel running at http://localhost:${PORT}`);
});
