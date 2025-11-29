// ==========================
//  WEBSOCKET LIVE UPDATES
// ==========================
const socket = io();
let playlistDownloadUrl = null;

// Log live status changes
socket.on("log", (line) => {
    appendLog(line);
});

// Live stream status update
socket.on("stream-update", () => {
    fetchStreams();
});

socket.on("job-progress", (payload) => {
    if (payload?.stage === "started") {
        appendLog("--- Status check started ---");
    }
});

socket.on("job-complete", (payload) => {
    appendLog("--- Status check completed ---");
    if (payload?.changes?.length) {
        appendLog(`Changes: ${payload.changes.join(", ")}`);
    }

    updatePlaylistDetails(payload);
});

function appendLog(text) {
    const logBox = document.getElementById("logOutput");
    logBox.textContent += text + "\n";

    // auto scroll
    logBox.scrollTop = logBox.scrollHeight;
}


// ==========================
//  DARK MODE
// ==========================
document.getElementById("darkModeBtn").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("darkMode", document.body.classList.contains("dark"));
});

// Load preference on boot
if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark");
}


// ==========================
//  STREAMS
// ==========================
async function fetchStreams() {
    const res = await fetch("/api/streams");
    const streams = await res.json();
    renderStreams(streams);
}

function renderStreams(streams) {
    const tbody = document.querySelector("#streamsTable tbody");
    tbody.innerHTML = "";

    streams.forEach(stream => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${stream.id}</td>
            <td>${stream.name || ""}</td>
            <td class="status-${stream.status}">${stream.status}</td>
            <td class="quality-${stream.quality}">${stream.quality}</td>
            <td>${stream.url}</td>
            <td>${stream.tvg_name || ""}</td>
            <td>${stream.tvg_chno || ""}</td>
            <td><button class="delete-btn" data-id="${stream.id}">Delete</button></td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll(".delete-btn").forEach(btn => {
        btn.addEventListener("click", () => deleteStream(btn.dataset.id));
    });
}

async function deleteStream(id) {
    if (!confirm("Delete stream " + id + "?")) return;
    await fetch(`/api/streams/${id}`, { method: "DELETE" });
    await fetchStreams();
}


// ==========================
//  ADD STREAM
// ==========================
async function addStream() {
    const payload = {
        name: document.getElementById("nameInput").value,
        url: document.getElementById("urlInput").value,
        tvg_name: document.getElementById("tvgNameInput").value,
        tvg_id: document.getElementById("tvgIdInput").value,
        tvg_chno: document.getElementById("tvgNumberInput").value,
        tvg_logo: document.getElementById("tvgLogoInput").value,
    };

    await fetch("/api/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    clearForm();
    fetchStreams();
}

function clearForm() {
    document.querySelectorAll(".form input").forEach(i => i.value = "");
}


// ==========================
//  IMPORT M3U
// ==========================
async function importM3u() {
    const m3uText = document.getElementById("m3uInput").value.trim();
    const resultEl = document.getElementById("importResult");

    if (!m3uText) {
        resultEl.textContent = "Paste your playlist first.";
        return;
    }

    resultEl.textContent = "Importing...";

    try {
        const res = await fetch("/api/streams/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ m3uContent: m3uText }),
        });

        const data = await res.json();

        if (!res.ok) {
            resultEl.textContent = data.message || "Failed to import playlist.";
            return;
        }

        resultEl.textContent = `${data.imported} added, ${data.skipped} skipped (total ${data.total}).`;
        document.getElementById("m3uInput").value = "";
        fetchStreams();
    } catch (err) {
        resultEl.textContent = err.message;
    }
}


// ==========================
//  SETTINGS
// ==========================
async function loadSettings() {
    const res = await fetch("/api/settings");
    const settings = await res.json();

    document.getElementById("frequencyInput").value = settings.frequencyMinutes;
    document.getElementById("cronText").innerText =
        "Cron Expression: " + settings.cronExpression;
}

async function saveSettings() {
    const frequencyMinutes = document.getElementById("frequencyInput").value;

    const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequencyMinutes }),
    });

    const data = await res.json();
    alert(data.message);
    loadSettings();
}

// ==========================
//  PLAYLIST INFO
// ==========================
function updatePlaylistDetails(info) {
    const statusEl = document.getElementById("playlistStatus");
    const metaEl = document.getElementById("playlistMeta");
    const downloadBtn = document.getElementById("downloadPlaylistBtn");

    const available = info?.playlistAvailable ?? info?.exists;
    const filename = info?.playlistFilename ?? info?.filename ?? "output.m3u";
    const updatedAt = info?.playlistUpdatedAt ?? info?.updatedAt;
    const size = info?.playlistSize ?? info?.size;

    if (available) {
        statusEl.textContent = `Current playlist: ${filename}`;
        if (updatedAt) {
            const updatedDate = new Date(updatedAt);
            metaEl.textContent = `Last updated: ${updatedDate.toLocaleString()} (${Math.round((size || 0) / 1024)} KB)`;
        } else {
            metaEl.textContent = "";
        }

        playlistDownloadUrl = info?.downloadUrl || "/api/playlist/download";
        downloadBtn.disabled = false;
    } else {
        statusEl.textContent = "Playlist not generated yet.";
        metaEl.textContent = "";
        playlistDownloadUrl = null;
        downloadBtn.disabled = true;
    }
}

async function loadPlaylistInfo() {
    try {
        const res = await fetch("/api/playlist");
        const info = await res.json();
        updatePlaylistDetails(info);
    } catch (err) {
        appendLog(`Playlist info error: ${err.message}`);
    }
}


// ==========================
//  RUN CHECK NOW
// ==========================
document.getElementById("runCheckNowBtn").addEventListener("click", async () => {
    appendLog(`=== Manual Check Started (${new Date().toLocaleTimeString()}) ===`);
    const res = await fetch("/api/run-check", { method: "POST" });
    const data = await res.json();
    appendLog(data.message);
});

function downloadPlaylist() {
    if (!playlistDownloadUrl) {
        alert("Playlist not available yet. Run a check to generate it.");
        return;
    }

    window.location.href = playlistDownloadUrl;
}


// ==========================
//  HOOK BUTTONS
// ==========================
document.getElementById("addStreamBtn").addEventListener("click", addStream);
document.getElementById("refreshBtn").addEventListener("click", fetchStreams);
document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
document.getElementById("downloadPlaylistBtn").addEventListener("click", downloadPlaylist);
document.getElementById("importM3uBtn").addEventListener("click", importM3u);


// ==========================
//  INITIAL LOAD
// ==========================
fetchStreams();
loadSettings();
loadPlaylistInfo();