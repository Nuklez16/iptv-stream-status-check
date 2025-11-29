// settings.js
const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, 'settings.json');
const DEFAULT_SETTINGS = { frequencyMinutes: 60 };

function isSupportedInterval(minutes) {
  return Number.isInteger(minutes)
    && minutes >= 1
    && minutes <= 1440
    && (minutes < 60 || minutes % 60 === 0);
}

function minutesToCron(minutes) {
  let normalized = minutes;
  if (!isSupportedInterval(normalized)) {
    normalized = DEFAULT_SETTINGS.frequencyMinutes;
  }

  if (normalized >= 60 && normalized % 60 === 0) {
    const hours = Math.max(1, Math.floor(normalized / 60));
    return `0 */${hours} * * *`;
  }

  return `*/${Math.max(1, normalized)} * * * *`;
}

function loadSettingsFromFile() {
  try {
    const contents = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(contents);
    if (!isSupportedInterval(parsed.frequencyMinutes)) {
      return { ...DEFAULT_SETTINGS };
    }
    return parsed;
  } catch (error) {
    // No file / invalid -> default
    return { ...DEFAULT_SETTINGS };
  }
}

let currentSettings = loadSettingsFromFile();

function getSettings() {
  return currentSettings;
}

function saveSettingsToFile(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function updateSettings(frequencyMinutes) {
  const rounded = Math.round(Number(frequencyMinutes));
  if (!isSupportedInterval(rounded)) {
    const message =
      'frequencyMinutes must be 1-59 minutes or a whole-number of hours (multiples of 60).';
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  }

  currentSettings = { frequencyMinutes: rounded };
  saveSettingsToFile(currentSettings);
  return currentSettings;
}

module.exports = {
  SETTINGS_PATH,
  DEFAULT_SETTINGS,
  getSettings,
  updateSettings,
  isSupportedInterval,
  minutesToCron,
};
