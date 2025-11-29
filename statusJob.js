// =====================================================
// statusJob.js — Stream Checking Engine + Cron Scheduler
// =====================================================

const cron = require("node-cron");
const { getIO } = require("./socket");

const { checkStreamStatus } = require("./streamStatus");
const {
  fetchStreamsFromDatabase,
  updateStreamStatus,
  generateM3UPlaylist,
  getPlaylistInfo,
} = require("./streamRepository");

const { minutesToCron } = require("./settings");
const { sendEmail } = require("./emailService");

let scheduledTask = null;
let isStatusCheckRunning = false;

// Accumulate human-readable changes for email/logging
const statusChanges = [];

// ----------------------------
// Log to console + broadcast
// ----------------------------
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);

  try {
    getIO().emit("log", line);
  } catch {
    // Socket may not be ready during very early startup
  }
}

function emitJobEvent(event, payload) {
  try {
    getIO().emit(event, payload);
  } catch {
    // Socket may not be ready during very early startup
  }
}

// ----------------------------
// Websocket broadcast for UI table refresh
// ----------------------------
function broadcastStreamUpdate() {
  try {
    getIO().emit("stream-update");
  } catch {
    // Ignore
  }
}

// ----------------------------
// Utility: Sleep
// ----------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ----------------------------
// Main Stream Check Routine
// ----------------------------
async function checkStreamStatusAndUpdate(streams) {
  const offline = [];
  let hadStatusChange = false;

  for (const stream of streams) {
    log(`Checking stream ${stream.id}: ${stream.url}`);

    try {
      const result = await checkStreamStatus(stream.url);

      log(
        `Stream ${stream.id} (${stream.name || "Unnamed"}) → ${
          result.isOnline ? "ONLINE" : "OFFLINE"
        }, quality=${result.quality}, frames=${result.frameCount}`
      );

      const update = await updateStreamStatus(
        stream.id,
        result.isOnline,
        result.quality
      );

      if (update.changed) {
        const line = `${update.name} - ${update.status} (${update.quality})`;
        log(`Status changed: ${line}`);
        statusChanges.push(line);
        hadStatusChange = true;
        broadcastStreamUpdate();
      }

      if (!result.isOnline) {
        offline.push(stream);
      }
    } catch (err) {
      log(`ERROR checking stream ${stream.id}: ${err.message}`);
    }

    // Small delay between checks to reduce load
    await sleep(15000);
  }

  const retryChange = await retryOfflineStreams(offline);

  return { hadStatusChange: hadStatusChange || retryChange };
}

// ----------------------------
// Retry offline streams once
// ----------------------------
async function retryOfflineStreams(offlineStreams) {
  if (!offlineStreams.length) {
    log("No offline streams detected; skipping retry phase.");
    return false;
  }

  let hadStatusChange = false;

  log(`Retrying ${offlineStreams.length} offline streams...`);

  for (const stream of offlineStreams) {
    log(`Retrying stream ${stream.id}: ${stream.url}`);

    try {
      const result = await checkStreamStatus(stream.url);

      log(
        `Retry result: ${stream.id} → ${
          result.isOnline ? "ONLINE" : "OFFLINE"
        } (${result.quality}), frames=${result.frameCount}`
      );

      const update = await updateStreamStatus(
        stream.id,
        result.isOnline,
        result.quality
      );

      if (update.changed) {
        const line = `${update.name} - ${update.status} (${update.quality})`;
        log(`Status changed (retry): ${line}`);
        statusChanges.push(line);
        hadStatusChange = true;
        broadcastStreamUpdate();
      }
    } catch (err) {
      log(`Retry ERROR stream ${stream.id}: ${err.message}`);
    }
  }

  return hadStatusChange;
}

// ----------------------------
// Fetch + Check Wrapper
// ----------------------------
async function fetchAndCheckStreams() {
  try {
    log("Fetching streams from database...");
    const streams = await fetchStreamsFromDatabase();
    log(`Fetched ${streams.length} streams to evaluate.`);

    return await checkStreamStatusAndUpdate(streams);
  } catch (err) {
    log(`Fetch error: ${err.message}`);
  }

  return { hadStatusChange: false };
}

// ----------------------------
// Job Executor
// ----------------------------
async function runStatusCheckJob() {
  if (isStatusCheckRunning) {
    log("Check already running, skipping this run.");
    return;
  }

  isStatusCheckRunning = true;
  statusChanges.length = 0;

  log("=== Status Check Started ===");
  emitJobEvent("job-progress", { stage: "started" });

  try {
    const { hadStatusChange } = await fetchAndCheckStreams();

    if (hadStatusChange) {
      await generateM3UPlaylist();
      log("M3U playlist regenerated and saved.");
    } else {
      log("No status changes detected; playlist unchanged.");
    }

    if (process.env.ENABLE_EMAIL === "true" && statusChanges.length > 0) {
      await sendEmail(statusChanges);
      log("Email notification sent.");
    } else {
      log("Email disabled or no status changes.");
    }
  } catch (err) {
    log(`Job Error: ${err.message}`);
  } finally {
    const playlistInfo = getPlaylistInfo();

    emitJobEvent("job-complete", {
      stage: "completed",
      playlistAvailable: playlistInfo.exists,
      playlistUpdatedAt: playlistInfo.updatedAt,
      playlistSize: playlistInfo.size,
      playlistFilename: playlistInfo.filename,
      changes: [...statusChanges],
    });

    log("=== Status Check Completed ===");
    isStatusCheckRunning = false;
  }
}

// ----------------------------
// Cron Scheduler
// ----------------------------
function scheduleStatusCheck(frequencyMinutes) {
  let cronExp = minutesToCron(frequencyMinutes);

  if (!cron.validate(cronExp)) {
    log(`Invalid cron expression (${cronExp}), reverting to hourly.`);
    cronExp = minutesToCron(60);
  }

  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule(cronExp, runStatusCheckJob, {
    scheduled: true,
  });

  log(`Cron scheduled: ${cronExp}`);
}

module.exports = {
  runStatusCheckJob,
  scheduleStatusCheck,
};
