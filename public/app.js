// ==========================
//  WEBSOCKET LIVE UPDATES
// ==========================
const socket = io();

// Log live status changes
socket.on("log", (line) => {
    appendLog(line);
});

// Live stream status update
socket.on("stream-update", () => {
    fetchStreams();
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
//  RUN CHECK NOW
// ==========================
document.getElementById("runCheckNowBtn").addEventListener("click", async () => {
    appendLog(`=== Manual Check Started (${new Date().toLocaleTimeString()}) ===`);
    const res = await fetch("/api/run-check", { method: "POST" });
    const data = await res.json();
    appendLog(data.message);
});


// ==========================
//  HOOK BUTTONS
// ==========================
document.getElementById("addStreamBtn").addEventListener("click", addStream);
document.getElementById("refreshBtn").addEventListener("click", fetchStreams);
document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);


// ==========================
//  INITIAL LOAD
// ==========================
fetchStreams();
loadSettings();
