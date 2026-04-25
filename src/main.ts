import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Settings {
  microphone: string;
  engine: string;
  whisperModel: string;
  groqApiKey: string;
  recordingMode: string;
  hotkey: string;
  historyTtlEnabled: boolean;
  historyTtlDays: number;
}

interface MicDevice {
  name: string;
  is_default: boolean;
}

interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

interface HistoryEntry {
  id: number;
  text: string;
  timestamp_ms: number;
}

// DOM elements
const statusDot = document.getElementById("status-dot")!;
const statusText = document.getElementById("status-text")!;
const micSelect = document.getElementById("mic-select") as HTMLSelectElement;
const engineLocal = document.getElementById("engine-local")!;
const engineCloud = document.getElementById("engine-cloud")!;
const localSettings = document.getElementById("local-settings")!;
const cloudSettings = document.getElementById("cloud-settings")!;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const downloadBtn = document.getElementById("download-btn")!;
const downloadProgress = document.getElementById("download-progress")!;
const progressFill = document.getElementById("progress-fill")!;
const groqKey = document.getElementById("groq-key") as HTMLInputElement;
const modeToggle = document.getElementById("mode-toggle")!;
const modePtt = document.getElementById("mode-ptt")!;
const hotkeyText = document.getElementById("hotkey-text")!;
const historyList = document.getElementById("history-list")!;
const historyEmpty = document.getElementById("history-empty")!;
const clearHistoryBtn = document.getElementById("clear-history-btn")!;
const ttlOff = document.getElementById("ttl-off")!;
const ttlOn = document.getElementById("ttl-on")!;
const ttlDurationRow = document.getElementById("ttl-duration-row")!;
const ttlDays = document.getElementById("ttl-days") as HTMLSelectElement;

// Section navigation
const navItems = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(".content-section");

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const target = item.getAttribute("data-section");
    navItems.forEach((n) => n.classList.remove("active"));
    sections.forEach((s) => s.classList.remove("active"));
    item.classList.add("active");
    document.getElementById(`section-${target}`)?.classList.add("active");
  });
});

// Window drag — titlebar and sidebar empty space
const titlebar = document.getElementById("titlebar")!;
const sidebar = document.getElementById("sidebar")!;
const appWindow = getCurrentWindow();

titlebar.addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).closest("button, select, input, a, .nav-item")) return;
  appWindow.startDragging();
});

sidebar.addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).closest("button, select, input, a, .nav-item")) return;
  appWindow.startDragging();
});

let currentSettings: Settings;

async function loadSettings() {
  currentSettings = await invoke<Settings>("get_settings");

  // Populate mic dropdown
  const mics = await invoke<MicDevice[]>("list_microphones");
  micSelect.innerHTML = "";
  mics.forEach((mic) => {
    const option = document.createElement("option");
    option.value = mic.name;
    option.textContent = mic.name + (mic.is_default ? " (default)" : "");
    micSelect.appendChild(option);
  });
  micSelect.value = currentSettings.microphone;

  // Engine
  setEngine(currentSettings.engine);

  // Model
  modelSelect.value = currentSettings.whisperModel;
  await checkModelStatus();

  // Groq key
  groqKey.value = currentSettings.groqApiKey;

  // Recording mode
  setRecordingMode(currentSettings.recordingMode);

  // Hotkey
  hotkeyText.textContent = currentSettings.hotkey.replace("CmdOrCtrl", "Cmd");

  // History TTL
  setHistoryTtlEnabled(currentSettings.historyTtlEnabled);
  ttlDays.value = String(currentSettings.historyTtlDays);
}

function setHistoryTtlEnabled(enabled: boolean) {
  currentSettings.historyTtlEnabled = enabled;
  ttlOff.classList.toggle("active", !enabled);
  ttlOn.classList.toggle("active", enabled);
  ttlDurationRow.classList.toggle("hidden", !enabled);
}

function setEngine(engine: string) {
  currentSettings.engine = engine;
  engineLocal.classList.toggle("active", engine === "local");
  engineCloud.classList.toggle("active", engine === "cloud");
  localSettings.classList.toggle("hidden", engine !== "local");
  cloudSettings.classList.toggle("hidden", engine !== "cloud");
}

function setRecordingMode(mode: string) {
  currentSettings.recordingMode = mode;
  modeToggle.classList.toggle("active", mode === "toggle");
  modePtt.classList.toggle("active", mode === "push-to-talk");
}

async function checkModelStatus() {
  const downloaded = await invoke<boolean>("check_model_downloaded", {
    modelSize: modelSelect.value,
  });
  downloadBtn.textContent = downloaded ? "\u2713" : "Download";
  (downloadBtn as HTMLButtonElement).disabled = downloaded;
}

async function saveSettings() {
  currentSettings.microphone = micSelect.value;
  currentSettings.whisperModel = modelSelect.value;
  currentSettings.groqApiKey = groqKey.value;
  currentSettings.historyTtlDays = Number(ttlDays.value);
  await invoke("save_settings", { settings: currentSettings });
}

// Event listeners
engineLocal.addEventListener("click", () => {
  setEngine("local");
  saveSettings();
});

engineCloud.addEventListener("click", () => {
  setEngine("cloud");
  saveSettings();
});

micSelect.addEventListener("change", () => saveSettings());

modelSelect.addEventListener("change", async () => {
  await checkModelStatus();
  saveSettings();
});

downloadBtn.addEventListener("click", async () => {
  (downloadBtn as HTMLButtonElement).disabled = true;
  downloadProgress.classList.remove("hidden");
  progressFill.style.width = "0%";

  try {
    await invoke("download_model", { modelSize: modelSelect.value });
    downloadBtn.textContent = "\u2713";
  } catch (e) {
    downloadBtn.textContent = "Retry";
    (downloadBtn as HTMLButtonElement).disabled = false;
    console.error("Download failed:", e);
  }
  downloadProgress.classList.add("hidden");
});

groqKey.addEventListener("change", () => saveSettings());

modeToggle.addEventListener("click", () => {
  setRecordingMode("toggle");
  saveSettings();
});

modePtt.addEventListener("click", () => {
  setRecordingMode("push-to-talk");
  saveSettings();
});

ttlOff.addEventListener("click", () => {
  setHistoryTtlEnabled(false);
  saveSettings();
});

ttlOn.addEventListener("click", () => {
  setHistoryTtlEnabled(true);
  saveSettings();
});

ttlDays.addEventListener("change", () => saveSettings());

async function loadHistory() {
  const entries = await invoke<HistoryEntry[]>("get_history");
  renderHistory(entries);
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

function renderHistory(entries: HistoryEntry[]) {
  historyList.innerHTML = "";

  if (entries.length === 0) {
    historyEmpty.classList.remove("hidden");
    return;
  }
  historyEmpty.classList.add("hidden");

  // Newest first
  const sorted = [...entries].sort((a, b) => b.timestamp_ms - a.timestamp_ms);

  for (const entry of sorted) {
    const item = document.createElement("div");
    item.className = "history-item";

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = formatTimestamp(entry.timestamp_ms);

    const text = document.createElement("div");
    text.className = "history-text";
    text.textContent = entry.text;

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-icon";
    copyBtn.dataset.action = "copy";
    copyBtn.dataset.id = String(entry.id);
    copyBtn.textContent = "Copy";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-icon";
    deleteBtn.dataset.action = "delete";
    deleteBtn.dataset.id = String(entry.id);
    deleteBtn.setAttribute("aria-label", "Delete");
    deleteBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path d="M3 4h10M6.5 4V2.5h3V4M5 4l.5 9a1.5 1.5 0 001.5 1.4h2a1.5 1.5 0 001.5-1.4L11 4"
          stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;

    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(meta);
    item.appendChild(text);
    item.appendChild(actions);

    historyList.appendChild(item);
  }
}

historyList.addEventListener("click", async (e) => {
  const target = (e.target as HTMLElement).closest("button.btn-icon") as HTMLButtonElement | null;
  if (!target) return;

  const action = target.dataset.action;
  const id = Number(target.dataset.id);

  if (action === "copy") {
    const item = target.closest(".history-item");
    const text = item?.querySelector(".history-text")?.textContent ?? "";
    try {
      await invoke("copy_history_entry", { text });
      const original = target.textContent;
      target.textContent = "Copied";
      target.disabled = true;
      setTimeout(() => {
        target.textContent = original;
        target.disabled = false;
      }, 1200);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  } else if (action === "delete") {
    try {
      await invoke("delete_history_entry", { id });
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }
});

clearHistoryBtn.addEventListener("click", async () => {
  if (!confirm("Clear all transcription history?")) return;
  try {
    await invoke("clear_history");
  } catch (err) {
    console.error("Clear failed:", err);
  }
});

listen<HistoryEntry[]>("history-updated", (event) => {
  renderHistory(event.payload);
});

// Listen for recording state changes
listen<string>("recording-state", (event) => {
  const state = event.payload;
  statusDot.className = "";
  if (state === "Recording") {
    statusDot.classList.add("recording");
    statusText.textContent = "Recording...";
  } else if (state === "Transcribing") {
    statusDot.classList.add("transcribing");
    statusText.textContent = "Transcribing...";
  } else {
    statusDot.classList.add("ready");
    statusText.textContent = "Ready";
  }
});

// Listen for download progress
listen<DownloadProgress>("download-progress", (event) => {
  const { percent } = event.payload;
  progressFill.style.width = `${percent}%`;
});

// Initialize
loadSettings();
loadHistory();
