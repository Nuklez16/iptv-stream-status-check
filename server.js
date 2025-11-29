// server.js — API + Static
const path = require("path");
const express = require("express");

const { query } = require("./db");
const { parseM3UContent } = require("./m3uParser");

const {
    getSettings,
    updateSettings,
    minutesToCron
} = require("./settings");

const { runStatusCheckJob } = require("./statusJob");
const { getPlaylistInfo, PLAYLIST_PATH, PLAYLIST_FILENAME } = require("./streamRepository");

function createServer(app, scheduleStatusCheck) {
    app.use(express.json({ limit: "2mb" }));

    // Static public folder
    const publicDir = path.join(__dirname, "public");
    app.use("/", express.static(publicDir));

    // STREAM ROUTES ----------------------

    app.get("/api/streams", async (req, res) => {
        try {
            const rows = await query(
                "SELECT id, name, url, status, quality, tvg_id, tvg_chno, tvg_logo, tvg_name FROM streams ORDER BY id DESC"
            );
            res.json(rows);
        } catch (err) {
            res.status(500).json({ message: "DB error" });
        }
    });

    app.post("/api/streams", async (req, res) => {
        const {
            name,
            url,
            tvg_id,
            tvg_chno,
            tvg_logo,
            tvg_name
        } = req.body;

        if (!url || !url.trim()) {
            return res.status(400).json({ message: "URL required" });
        }

        const newStream = {
            name: name?.trim() || null,
            url: url.trim(),
            status: "offline",
            quality: "unverified",
            tvg_id: tvg_id?.trim() || null,
            tvg_chno: tvg_chno || null,
            tvg_logo: tvg_logo || null,
            tvg_name: tvg_name || name || null
        };

        try {
            const result = await query("INSERT INTO streams SET ?", newStream);
            res.status(201).json({ id: result.insertId, ...newStream });
        } catch (err) {
            res.status(500).json({ message: "DB error" });
        }
    });

    app.post("/api/streams/import", async (req, res) => {
        const { m3uContent } = req.body;

        if (!m3uContent || typeof m3uContent !== "string") {
            return res.status(400).json({ message: "m3uContent is required" });
        }

        let parsedEntries = [];
        try {
            parsedEntries = parseM3UContent(m3uContent);
        } catch (err) {
            return res.status(400).json({ message: err.message || "Invalid M3U" });
        }

        if (!parsedEntries.length) {
            return res.status(400).json({ message: "No playable entries found in the playlist" });
        }

        try {
            const existing = await query("SELECT url FROM streams");
            const urlSet = new Set(existing.map(r => r.url));

            let imported = 0;
            let skipped = 0;

            for (const entry of parsedEntries) {
                const normalizedUrl = entry.url?.trim();
                if (!normalizedUrl || urlSet.has(normalizedUrl)) {
                    skipped++;
                    continue;
                }

                urlSet.add(normalizedUrl);

                const newStream = {
                    name: entry.name || entry.tvg_name || null,
                    url: normalizedUrl,
                    status: "offline",
                    quality: "unverified",
                    tvg_id: entry.tvg_id || null,
                    tvg_chno: entry.tvg_chno || null,
                    tvg_logo: entry.tvg_logo || null,
                    tvg_name: entry.tvg_name || entry.name || null,
                };

                await query("INSERT INTO streams SET ?", newStream);
                imported++;
            }

            res.status(201).json({
                message: "Playlist imported",
                imported,
                skipped,
                total: parsedEntries.length,
            });
        } catch (err) {
            res.status(500).json({ message: "DB error" });
        }
    });

    app.delete("/api/streams/:id", async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) {
            return res.status(400).json({ message: "Invalid ID" });
        }

        try {
            const result = await query("DELETE FROM streams WHERE id=?", [id]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: "Not found" });
            }

            res.json({ message: "Deleted" });
        } catch (err) {
            res.status(500).json({ message: "DB error" });
        }
    });

    // SETTINGS ----------------------

    app.get("/api/settings", (req, res) => {
        const s = getSettings();
        res.json({
            frequencyMinutes: s.frequencyMinutes,
            cronExpression: minutesToCron(s.frequencyMinutes)
        });
    });

    app.post("/api/settings", (req, res) => {
        const { frequencyMinutes } = req.body;

        try {
            const newSettings = updateSettings(frequencyMinutes);
            scheduleStatusCheck(newSettings.frequencyMinutes);

            res.json({
                message: "Settings updated",
                frequencyMinutes: newSettings.frequencyMinutes,
                cronExpression: minutesToCron(newSettings.frequencyMinutes)
            });

        } catch (err) {
            res.status(err.statusCode || 400).json({ message: err.message });
        }
    });

    // PLAYLIST ----------------------
    app.get("/api/playlist", (req, res) => {
        const info = getPlaylistInfo();

        res.json({
            exists: info.exists,
            updatedAt: info.updatedAt,
            size: info.size,
            filename: info.filename,
            downloadUrl: info.exists ? "/api/playlist/download" : null,
        });
    });

    app.get("/api/playlist/download", (req, res) => {
        const info = getPlaylistInfo();

        if (!info.exists) {
            return res.status(404).json({ message: "Playlist not generated yet." });
        }

        res.download(PLAYLIST_PATH, PLAYLIST_FILENAME);
    });

    // MANUAL RUN ----------------------

    app.post("/api/run-check", async (req, res) => {
        runStatusCheckJob().then(() => {
            res.json({ message: "Manual check complete." });
        });
    });

    console.log("Web dashboard API ready.");
}

module.exports = {
    createServer
};