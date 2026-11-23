// Controller for recordings.html (Recordings History)

const STORAGE_INDEX_KEY = "openjam_recordings_index";
const GITHUB_CONFIG_KEY = "openjam_github_config";

const tbody = document.getElementById("recordings-body");
const searchBox = document.getElementById("search-box");
const showingCount = document.getElementById("showing-count");
const statTotal = document.getElementById("stat-total");
const statDomains = document.getElementById("stat-domains");
const statPublished = document.getElementById("stat-published");

let allRecordings = [];

function extractDomain(url) {
  if (!url) return "unknown site";
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms) {
  if (!ms) return "";
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function renderTable(items) {
  tbody.innerHTML = "";
  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">
          <h3>No recordings found</h3>
          <p>No recorded sessions match your filter. Start recording on any web page to see history here.</p>
        </td>
      </tr>`;
    showingCount.textContent = "Showing 0 recordings";
    return;
  }

  showingCount.textContent = `Showing ${items.length} recording${items.length === 1 ? "" : "s"}`;

  items.forEach((rec) => {
    const tr = document.createElement("tr");
    const domain = extractDomain(rec.pageUrl);
    const dateObj = new Date(rec.timestamp || Date.now());
    const formattedDate = dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const ago = timeAgo(dateObj);

    const tags = [];
    if (rec.hasReplay) tags.push('<span class="meta-tag tag-replay">Replay</span>');
    if (rec.hasAudio) tags.push('<span class="meta-tag tag-audio">Audio</span>');
    if (rec.githubPagesUrl) tags.push('<span class="meta-tag tag-github">GitHub Pages</span>');

    const dur = rec.durationMs ? formatDuration(rec.durationMs) : "";
    const metaDetails = dur ? `${dur} · ${rec.eventCount || 0} events` : `${rec.eventCount || 0} events`;

    // Action buttons
    let actionButtons = "";
    if (rec.key) {
      actionButtons += `<a href="viewer.html?key=${encodeURIComponent(rec.key)}" class="btn-action primary" target="_blank">Open Viewer</a>`;
    }
    if (rec.githubPagesUrl) {
      actionButtons += `<a href="${rec.githubPagesUrl}" class="btn-action secondary" target="_blank" rel="noopener" title="Open Public GitHub Pages Link">🌐 Link</a>`;
    }

    tr.innerHTML = `
      <td>
        <div>
          <span class="domain-badge">${domain}</span>
          <a href="viewer.html?key=${encodeURIComponent(rec.key || "")}" class="page-title" target="_blank" title="${rec.pageTitle || domain}">
            ${rec.pageTitle || "Untitled Recording"}
          </a>
          ${rec.pageUrl ? `<a href="${rec.pageUrl}" class="page-url" target="_blank" rel="noopener">${rec.pageUrl}</a>` : ""}
          <div style="display: flex; gap: 5px; margin-top: 4px;">${tags.join(" ")}</div>
        </div>
      </td>
      <td class="timestamp-cell">
        <span>${formattedDate}</span>
        <span class="time-rel">${ago}</span>
      </td>
      <td style="font-family: var(--mono); font-size: 11.5px; color: var(--muted); white-space: nowrap;">
        ${metaDetails}
      </td>
      <td>
        <div class="actions-cell">
          ${actionButtons}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadData() {
  try {
    const store = await chrome.storage.local.get(null);
    const indexList = store[STORAGE_INDEX_KEY] || [];

    // Also collect any full reports currently stored in storage that might not be in index
    const storedReports = [];
    Object.keys(store).forEach((k) => {
      if (k.startsWith("report-")) {
        const rep = store[k];
        if (rep && rep.meta) {
          storedReports.push({
            key: k,
            timestamp: rep.meta.capturedAt,
            pageUrl: rep.meta.pageUrl || "",
            pageTitle: rep.meta.pageTitle || "",
            durationMs: rep.meta.durationMs || 0,
            eventCount: rep.meta.eventCount || 0,
            hasReplay: !!(rep.rrwebEvents && (Array.isArray(rep.rrwebEvents) ? rep.rrwebEvents.length > 1 : rep.rrwebEvents.length > 10)),
            hasAudio: !!(rep.audio && rep.audio.dataUrl),
          });
        }
      }
    });

    // Merge and deduplicate by key or timestamp
    const map = new Map();
    [...storedReports, ...indexList].forEach((item) => {
      if (item && (item.key || item.timestamp)) {
        const id = item.key || String(item.timestamp);
        map.set(id, { ...map.get(id), ...item });
      }
    });

    allRecordings = Array.from(map.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    // Update summary statistics
    statTotal.textContent = allRecordings.length;
    const domainsSet = new Set(allRecordings.map((r) => extractDomain(r.pageUrl)).filter(Boolean));
    statDomains.textContent = domainsSet.size;
    const publishedCount = allRecordings.filter((r) => r.githubPagesUrl).length;
    statPublished.textContent = publishedCount;

    renderTable(allRecordings);
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state" style="color: var(--red);">
          <h3>Error loading recordings</h3>
          <p>${err.message}</p>
        </td>
      </tr>`;
  }
}

searchBox.addEventListener("input", (e) => {
  const q = (e.target.value || "").toLowerCase().trim();
  if (!q) {
    renderTable(allRecordings);
    return;
  }
  const filtered = allRecordings.filter((r) => {
    const text = `${r.pageTitle || ""} ${r.pageUrl || ""} ${extractDomain(r.pageUrl)}`.toLowerCase();
    return text.includes(q);
  });
  renderTable(filtered);
});

loadData();
