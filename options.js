// Options controller for OpenJam GitHub Pages Auto-Publisher.
// Persists settings to chrome.storage.local under 'openjam_github_config'.

const STORAGE_KEY = "openjam_github_config";
const PREFS_KEY = "openjam_recording_prefs";

const patInput = document.getElementById("pat");
const ownerInput = document.getElementById("owner");
const repoInput = document.getElementById("repo");
const branchInput = document.getElementById("branch");
const prefixInput = document.getElementById("prefix");
const togglePatBtn = document.getElementById("toggle-pat");
const form = document.getElementById("config-form");
const saveBtn = document.getElementById("save-btn");
const testBtn = document.getElementById("test-btn");
const statusMsg = document.getElementById("status-message");

const prefsForm = document.getElementById("prefs-form");
const prefMouseMove = document.getElementById("pref-mouse-move");
const prefMouseTail = document.getElementById("pref-mouse-tail");
const prefConsole = document.getElementById("pref-console");
const prefNetwork = document.getElementById("pref-network");
const prefsStatusMsg = document.getElementById("prefs-status-message");

function showPrefsStatus(text, type = "info") {
  if (!prefsStatusMsg) return;
  prefsStatusMsg.textContent = text;
  prefsStatusMsg.className = `status ${type}`;
  prefsStatusMsg.hidden = false;
  setTimeout(() => { prefsStatusMsg.hidden = true; }, 4000);
}

function showStatus(text, type = "info") {
  statusMsg.textContent = text;
  statusMsg.className = `status ${type}`;
  statusMsg.hidden = false;
  statusMsg.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearStatus() {
  statusMsg.hidden = true;
  statusMsg.textContent = "";
}

// Load saved configuration
async function loadConfig() {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY, PREFS_KEY]);
    const config = res[STORAGE_KEY] || {};
    if (config.pat) patInput.value = config.pat;
    if (config.owner) ownerInput.value = config.owner;
    if (config.repo) repoInput.value = config.repo;
    if (config.branch) branchInput.value = config.branch;
    if (config.prefix) prefixInput.value = config.prefix;

    const prefs = res[PREFS_KEY] || {};
    if (prefMouseMove) prefMouseMove.checked = prefs.recordMouseMove !== false;
    if (prefMouseTail) prefMouseTail.checked = prefs.showMouseTail !== false;
    if (prefConsole) prefConsole.checked = prefs.recordConsole !== false;
    if (prefNetwork) prefNetwork.checked = prefs.recordNetwork !== false;
  } catch (err) {
    showStatus("Failed to load saved settings: " + err.message, "error");
  }
}

if (prefsForm) {
  prefsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prefs = {
      recordMouseMove: prefMouseMove.checked,
      showMouseTail: prefMouseTail.checked,
      recordConsole: prefConsole.checked,
      recordNetwork: prefNetwork.checked,
    };
    try {
      await chrome.storage.local.set({ [PREFS_KEY]: prefs });
      showPrefsStatus("Preferences saved successfully!", "success");
    } catch (err) {
      showPrefsStatus("Failed to save preferences: " + err.message, "error");
    }
  });
}

// Toggle PAT visibility
togglePatBtn.addEventListener("click", () => {
  if (patInput.type === "password") {
    patInput.type = "text";
    togglePatBtn.textContent = "Hide";
  } else {
    patInput.type = "password";
    togglePatBtn.textContent = "Show";
  }
});

// Save configuration
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const pat = patInput.value.trim();
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();
  const branch = branchInput.value.trim() || "main";
  const prefix = prefixInput.value.trim() || "openjam";

  if (!pat || !owner || !repo) {
    showStatus("Please provide Personal Access Token, Owner, and Repository.", "error");
    return;
  }

  const config = { pat, owner, repo, branch, prefix };

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: config });
    showStatus("Configuration saved successfully!", "success");
  } catch (err) {
    showStatus("Failed to save configuration: " + err.message, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Configuration";
  }
});

// Test connection to GitHub API
testBtn.addEventListener("click", async () => {
  clearStatus();

  const pat = patInput.value.trim();
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();

  if (!pat || !owner || !repo) {
    showStatus("Please enter Personal Access Token, Owner, and Repository before testing.", "error");
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = "Testing...";
  showStatus(`Connecting to https://api.github.com/repos/${owner}/${repo}...`, "info");

  try {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "OpenJam-Extension",
      },
    });

    if (res.ok) {
      const data = await res.json();
      const visibility = data.private ? "Private" : "Public";
      const defaultBranch = data.default_branch || "main";
      showStatus(
        `Connection successful! Connected to ${data.full_name} (${visibility}). Default branch: "${defaultBranch}".`,
        "success",
      );
    } else if (res.status === 401) {
      showStatus("Authentication failed (401 Unauthorized): Personal Access Token is invalid or expired.", "error");
    } else if (res.status === 404) {
      showStatus(
        `Repository "${owner}/${repo}" not found (404 Not Found). Please verify repository name and PAT permissions.`,
        "error",
      );
    } else {
      const errData = await res.json().catch(() => ({}));
      showStatus(`GitHub API error (${res.status}): ${errData.message || res.statusText}`, "error");
    }
  } catch (err) {
    showStatus(`Connection failed: ${err.message}. Check your internet connection.`, "error");
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = "Test Connection";
  }
});

loadConfig();
