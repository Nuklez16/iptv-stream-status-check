// ==========================
//  WEBSOCKET LIVE UPDATES
// ==========================
const socket = io();
let playlistDownloadUrl = null;
let streamsState = [];
let editingStreamId = null;
let logsPaused = false;
let logBuffer = [];

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
    loadPlaylistPreview();
});

function writeLog(text) {
    const logBox = document.getElementById("logOutput");
    logBox.textContent += text + "\n";
    logBox.scrollTop = logBox.scrollHeight;
}

function appendLog(text) {
    if (logsPaused) {
        logBuffer.push(text);
        return;
    }
    writeLog(text);
}

function clearLogs() {
    document.getElementById("logOutput").textContent = "";
    logBuffer = [];
}

function togglePauseLogs() {
    const button = document.getElementById("pauseLogsBtn");
    const icon = button.querySelector("i");
    logsPaused = !logsPaused;

    if (logsPaused) {
        button.title = "Resume logs";
        if (icon) icon.className = "fas fa-play";
    } else {
        button.title = "Pause logs";
        if (icon) icon.className = "fas fa-pause";
        if (logBuffer.length) {
            logBuffer.forEach(writeLog);
            logBuffer = [];
        }
    }
}

// ==========================
//  DARK MODE
// ==========================
const darkModeBtn = document.getElementById("darkModeBtn");

function updateThemeToggleButton() {
    const isDark = document.body.classList.contains("dark");
    darkModeBtn.innerHTML = "";

    const icon = document.createElement("i");
    icon.className = isDark ? "fas fa-sun" : "fas fa-moon";
    darkModeBtn.appendChild(icon);
    darkModeBtn.appendChild(document.createTextNode(isDark ? " Toggle Light Mode" : " Toggle Dark Mode"));
}

darkModeBtn.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("darkMode", document.body.classList.contains("dark"));
    updateThemeToggleButton();
});

if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark");
}
updateThemeToggleButton();

// ==========================
//  STREAMS
// ==========================
async function fetchStreams() {
    const res = await fetch("/api/streams");
    const streams = await res.json();
    streamsState = streams;
    renderStreams(streamsState);
}

async function importStreams() {
    const textarea = document.getElementById("importTextarea");
    const statusEl = document.getElementById("importStatus");
    statusEl.textContent = "";

    const content = textarea.value;

    if (!content.trim()) {
        statusEl.textContent = "Paste playlist content first.";
        return;
    }

    const res = await fetch("/api/streams/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
    });

    const data = await res.json();

    if (!res.ok) {
        statusEl.textContent = data?.message || "Import failed.";
        return;
    }

    statusEl.textContent = `Imported ${data.imported} entries (${data.logoCount} with logos).`;
    renderImportSummary(data);
    fetchStreams();
}

function renderImportSummary(summary) {
    const container = document.getElementById("importSummary");
    container.innerHTML = "";

    if (!summary?.groups?.length) {
        container.innerHTML = "<p class=\"tiny\">No summary available.</p>";
        container.classList.add("show");
        return;
    }

    summary.groups.forEach(group => {
        const groupEl = document.createElement("div");
        groupEl.className = "import-summary-group";

        const title = document.createElement("div");
        title.className = "import-summary-title";
        title.textContent = `${group.name} (${group.count})`;
        groupEl.appendChild(title);

        const meta = document.createElement("div");
        meta.className = "import-summary-meta";
        meta.textContent = `${group.logoCount} logos`;
        groupEl.appendChild(meta);

        const sampleList = document.createElement("div");
        sampleList.className = "import-summary-samples";
        group.samples?.forEach(sample => {
            const item = document.createElement("div");
            item.className = "import-summary-sample";

            if (sample.logo) {
                const img = document.createElement("img");
                img.src = sample.logo;
                img.alt = sample.name;
                item.appendChild(img);
            }

            const name = document.createElement("span");
            name.textContent = sample.name;
            item.appendChild(name);

            sampleList.appendChild(item);
        });

        groupEl.appendChild(sampleList);
        container.appendChild(groupEl);
    });

    container.classList.add("show");
}

function renderStreams(streams = streamsState) {
    const tbody = document.querySelector("#streamsTable tbody");
    tbody.innerHTML = "";

    streams.forEach(stream => {
        const isEditing = editingStreamId === stream.id;
        const tr = document.createElement("tr");
        tr.dataset.id = stream.id;

        const statusBadge = `<span class="status-badge ${stream.status === "online" ? "status-online" : "status-offline"}">\n            <i class="fas fa-${stream.status === "online" ? "check-circle" : "times-circle"}"></i>\n            ${stream.status || "unknown"}\n        </span>`;

        const quality = stream.quality || "unverified";
        const qualityClass = `quality-${quality}`;
        const qualityText = quality.charAt(0).toUpperCase() + quality.slice(1);
        const truncatedUrl = (stream.url || "").length > 40 ? `${stream.url.slice(0, 40)}...` : (stream.url || "");
        const logoPreview = stream.tvg_logo ? `<span class="small">${stream.tvg_logo.slice(0, 35)}...</span>` : "<span class=\"tiny\">No logo</span>";

        if (isEditing) {
            tr.innerHTML = `
                <td>${stream.id}</td>
                <td><input class="inline-input" data-field="name" value="${stream.name || ""}" /></td>
                <td>${statusBadge}</td>
                <td><span class="${qualityClass}">${qualityText}</span></td>
                <td><input class="inline-input" data-field="url" value="${stream.url}" /></td>
                <td><input class="inline-input" data-field="tvg_name" value="${stream.tvg_name || ""}" /></td>
                <td><input class="inline-input" data-field="tvg_id" value="${stream.tvg_id || ""}" /></td>
                <td><input class="inline-input" data-field="tvg_chno" type="number" value="${stream.tvg_chno || ""}" /></td>
                <td><input class="inline-input" data-field="tvg_logo" value="${stream.tvg_logo || ""}" /></td>
                <td class="action-buttons">
                    <button class="btn-primary save-btn" data-id="${stream.id}"><i class="fas fa-save"></i> Save</button>
                    <button class="btn-secondary cancel-btn" data-id="${stream.id}"><i class="fas fa-times"></i> Cancel</button>
                </td>
            `;
        } else {
            tr.innerHTML = `
                <td>${stream.id}</td>
                <td>${stream.name || ""}</td>
                <td>${statusBadge}</td>
                <td><span class="${qualityClass}">${qualityText}</span></td>
                <td class="small" title="${stream.url || ""}">${truncatedUrl}</td>
                <td>${stream.tvg_name || ""}</td>
                <td>${stream.tvg_id || ""}</td>
                <td>${stream.tvg_chno || ""}</td>
                <td class="logo-cell">${logoPreview}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-outline btn-icon edit-btn" data-id="${stream.id}" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-outline btn-icon delete-btn" data-id="${stream.id}" title="Delete"><i class="fas fa-trash"></i></button>
                        <button class="btn-outline btn-icon test-btn" data-id="${stream.id}" title="Test stream"><i class="fas fa-play"></i></button>
                    </div>
                </td>
            `;
        }
        tbody.appendChild(tr);
    });

    document.querySelectorAll(".delete-btn").forEach(btn => {
        btn.addEventListener("click", () => deleteStream(btn.dataset.id));
    });

    document.querySelectorAll(".edit-btn").forEach(btn => {
        btn.addEventListener("click", () => startEditStream(btn.dataset.id));
    });

    document.querySelectorAll(".save-btn").forEach(btn => {
        btn.addEventListener("click", () => saveStreamEdit(btn.dataset.id));
    });

    document.querySelectorAll(".cancel-btn").forEach(btn => {
        btn.addEventListener("click", () => cancelEdit());
    });

    document.querySelectorAll(".test-btn").forEach(btn => {
        btn.addEventListener("click", () => testStream(btn.dataset.id));
    });
}

async function deleteStream(id) {
    if (!confirm("Delete stream " + id + "?")) return;
    editingStreamId = null;
    await fetch(`/api/streams/${id}`, { method: "DELETE" });
    await fetchStreams();
}

function startEditStream(id) {
    editingStreamId = Number(id);
    renderStreams();
}

function cancelEdit() {
    editingStreamId = null;
    renderStreams();
}

async function saveStreamEdit(id) {
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (!row) return;

    const payload = {
        name: row.querySelector('[data-field="name"]').value,
        url: row.querySelector('[data-field="url"]').value,
        tvg_name: row.querySelector('[data-field="tvg_name"]').value,
        tvg_id: row.querySelector('[data-field="tvg_id"]').value,
        tvg_chno: row.querySelector('[data-field="tvg_chno"]').value,
        tvg_logo: row.querySelector('[data-field="tvg_logo"]').value,
    };

    const res = await fetch(`/api/streams/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
        alert(data?.message || "Failed to update stream");
        return;
    }

    editingStreamId = null;
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
//  SETTINGS
// ==========================
async function loadSettings() {
    const res = await fetch("/api/settings");
    const settings = await res.json();

    document.getElementById("frequencyInput").value = settings.frequencyMinutes;
    document.getElementById("cronText").innerText = formatCronText(settings.frequencyMinutes, settings.cronExpression);
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

function formatCronText(frequencyMinutes, cronExpression) {
    if (!frequencyMinutes) return "Not scheduled";
    return `Every ${frequencyMinutes} minutes (Cron: ${cronExpression})`;
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

async function loadPlaylistPreview() {
    const statusEl = document.getElementById("playlistEmptyMessage");
    const listEl = document.getElementById("playlistChannels");

    listEl.innerHTML = "";
    statusEl.textContent = "Loading playlist...";

    try {
        const res = await fetch("/api/playlist/channels");
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data?.message || "Unable to load playlist");
        }

        renderPlaylistChannels(data.channels || []);
    } catch (err) {
        statusEl.textContent = err.message;
    }
}

function renderPlaylistChannels(channels) {
    const listEl = document.getElementById("playlistChannels");
    const statusEl = document.getElementById("playlistEmptyMessage");

    listEl.innerHTML = "";

    if (!channels?.length) {
        statusEl.textContent = "Playlist not generated yet or empty.";
        return;
    }

    statusEl.textContent = `${channels.length} channels in current playlist.`;

    channels.forEach(channel => {
        const channelEl = document.createElement("div");
        channelEl.className = "channel-card";

        const safeTitle = channel.tvg_name || channel.name || "Untitled Channel";
        const metaParts = [];
        if (channel.tvg_id) metaParts.push(`ID: ${channel.tvg_id}`);
        if (channel.tvg_chno) metaParts.push(`CH ${channel.tvg_chno}`);
        const truncatedUrl = (channel.url || "").length > 60 ? `${channel.url.slice(0, 60)}...` : (channel.url || "");

        channelEl.innerHTML = `
            ${channel.tvg_logo ? `<img src="${channel.tvg_logo}" alt="${safeTitle}" class="channel-logo">` : ""}
            <div class="channel-name">${safeTitle}</div>
            <div class="channel-number">${metaParts.join(" • ") || "No metadata"}</div>
            ${channel.status ? `<span class="status-badge ${channel.status === "online" ? "status-online" : "status-offline"}"><i class="fas fa-${channel.status === "online" ? "check-circle" : "times-circle"}"></i>${channel.status}</span>` : ""}
            <div class="channel-url" title="${channel.url || ""}">${truncatedUrl}</div>
        `;

        listEl.appendChild(channelEl);
    });
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

async function testStream(id) {
    appendLog(`Manual test requested for stream ${id}`);
    try {
        const res = await fetch("/api/run-check", { method: "POST" });
        const data = await res.json();
        appendLog(data.message || "Check triggered.");
    } catch (err) {
        appendLog(`Test failed: ${err.message}`);
    }
}

function handleFrequencyInput(e) {
    const value = e.target.value;
    if (value) {
        document.getElementById("cronText").textContent = `Every ${value} minutes`;
    } else {
        document.getElementById("cronText").textContent = "Not scheduled";
    }
}

// ==========================
//  HOOK BUTTONS
// ==========================
document.getElementById("addStreamBtn").addEventListener("click", addStream);
document.getElementById("refreshBtn").addEventListener("click", fetchStreams);
document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
document.getElementById("downloadPlaylistBtn").addEventListener("click", downloadPlaylist);
document.getElementById("importBtn").addEventListener("click", importStreams);
document.getElementById("refreshPlaylistPreviewBtn").addEventListener("click", loadPlaylistPreview);
document.getElementById("clearLogsBtn").addEventListener("click", clearLogs);
document.getElementById("pauseLogsBtn").addEventListener("click", togglePauseLogs);
document.getElementById("frequencyInput").addEventListener("input", handleFrequencyInput);

// ==========================
//  INITIAL LOAD
// ==========================
fetchStreams();
loadSettings();
loadPlaylistInfo();
loadPlaylistPreview();
appendLog(`[INFO] ${new Date().toLocaleTimeString()} - M3U Stream Checker initialized`);
