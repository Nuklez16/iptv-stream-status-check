// streamRepository.js
const fs = require("fs");
const path = require("path");
const { query } = require("./db");

const PLAYLIST_FILENAME = "output.m3u";
const PLAYLIST_PATH = path.join(__dirname, "public", PLAYLIST_FILENAME);

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

    fs.writeFileSync(PLAYLIST_PATH, m3u);

    return PLAYLIST_PATH;
}

function getPlaylistInfo() {
    try {
        const stats = fs.statSync(PLAYLIST_PATH);

        return {
            exists: true,
            updatedAt: stats.mtime,
            size: stats.size,
            filename: PLAYLIST_FILENAME,
        };
    } catch {
        return {
            exists: false,
            updatedAt: null,
            size: 0,
            filename: PLAYLIST_FILENAME,
        };
    }
}

module.exports = {
    fetchStreamsFromDatabase,
    updateStreamStatus,
    generateM3UPlaylist,
    getPlaylistInfo,
    PLAYLIST_PATH,
    PLAYLIST_FILENAME,
};
