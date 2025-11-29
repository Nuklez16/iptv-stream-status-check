// streamRepository.js
const fs = require("fs");
const path = require("path");
const { query } = require("./db");

// Fetch all streams
async function fetchStreamsFromDatabase() {
    return await query("SELECT id, url, name FROM streams");
}

// Update stream status and detect changes
async function updateStreamStatus(streamId, isOnline, quality) {
    const status = isOnline ? "online" : "offline";

    // Fetch current
    const rows = await query(
        "SELECT status, name, quality FROM streams WHERE id = ?",
        [streamId]
    );

    if (!rows.length) {
        return { changed: false };
    }

    const row = rows[0];

    if (row.status === status && row.quality === quality) {
        return { changed: false };
    }

    // Update
    await query(
        "UPDATE streams SET status = ?, quality = ? WHERE id = ?",
        [status, quality, streamId]
    );

    return {
        changed: true,
        name: row.name || "Unnamed Stream",
        status,
        quality
    };
}

// Generate M3U file
async function generateM3UPlaylist() {
    const rows = await query(
        "SELECT url, tvg_id, tvg_chno, tvg_logo, tvg_name FROM streams WHERE status = 'online'"
    );

    let m3u = "#EXTM3U\n";

    for (const r of rows) {
        m3u += `#EXTINF:-1 tvg-id="${r.tvg_id}" tvg-chno="${r.tvg_chno}" tvg-name="${r.tvg_name}" tvg-logo="${r.tvg_logo}", ${r.tvg_name}\n`;
        m3u += `${r.url}\n`;
    }

    const file = "/root/app/output.m3u";
    fs.writeFileSync(file, m3u);

    return file;
}

module.exports = {
    fetchStreamsFromDatabase,
    updateStreamStatus,
    generateM3UPlaylist
};
