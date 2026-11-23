#!/usr/bin/env node

/**
 * generate-index.js
 * Scans ../docs/reports/ directory for OpenJam HTML report files,
 * extracts report metadata, and updates/generates the reports index
 * table inside ../docs/index.html for GitHub Pages hosting.
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(SCRIPT_DIR, "../docs/reports");
const INDEX_FILE = resolve(SCRIPT_DIR, "../docs/index.html");

const START_MARKER = "<!-- reports-table:start -->";
const END_MARKER = "<!-- reports-table:end -->";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseReportFile(filePath, filename) {
  const stats = statSync(filePath);
  let pageTitle = filename;
  let pageUrl = "";
  let capturedAt = stats.mtime.toISOString();
  let durationMs = null;
  let eventCount = null;
  let errorCount = 0;
  let hasReplay = false;
  let hasAudio = false;

  try {
    const content = readFileSync(filePath, "utf8");

    // 1. Try to extract embedded #openjam-data
    const dataMatch = content.match(/<script id="openjam-data" type="application\/json">([\s\S]*?)<\/script>/);
    if (dataMatch && dataMatch[1]) {
      try {
        const data = JSON.parse(dataMatch[1]);
        if (data.meta) {
          pageTitle = data.meta.pageTitle || pageTitle;
          pageUrl = data.meta.pageUrl || "";
          if (data.meta.capturedAt) capturedAt = new Date(data.meta.capturedAt).toISOString();
          if (data.meta.durationMs) durationMs = data.meta.durationMs;
        }
        if (Array.isArray(data.events)) {
          eventCount = data.events.length;
          errorCount = data.events.filter(e => e.kind === "error" || e.kind === "console_error").length;
        }
        if (data.rrwebEvents && (Array.isArray(data.rrwebEvents) ? data.rrwebEvents.length > 1 : data.rrwebEvents.length > 10)) {
          hasReplay = true;
        }
        if (data.audio && data.audio.dataUrl) {
          hasAudio = true;
        }
      } catch (jsonErr) {
        // Fallback to title regex if json parse failed
      }
    }

    // 2. Fallback to <title>
    if (pageTitle === filename) {
      const titleMatch = content.match(/<title>([^<]*)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        pageTitle = titleMatch[1].replace(/^OpenJam Report:\s*/i, "").trim() || filename;
      }
    }
  } catch (err) {
    console.warn(`Could not parse details from ${filename}:`, err.message);
  }

  return {
    filename,
    relativePath: `reports/${encodeURIComponent(filename).replace(/%2F/g, "/")}`,
    pageTitle,
    pageUrl,
    capturedAt,
    fileSizeKb: (stats.size / 1024).toFixed(1),
    durationMs,
    eventCount,
    errorCount,
    hasReplay,
    hasAudio,
  };
}

function formatDuration(ms) {
  if (!ms || isNaN(ms)) return "";
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return isoString;
  }
}

function buildReportsTableHtml(files) {
  const countText = `${files.length} report${files.length === 1 ? "" : "s"}`;

  let rowsHtml = "";
  if (files.length === 0) {
    rowsHtml = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 36px 20px; color: var(--muted); font-style: italic;">
          No reports published yet in <code>docs/reports/</code>. Record and upload via OpenJam extension to publish here.
        </td>
      </tr>`;
  } else {
    for (const r of files) {
      const tags = [];
      if (r.hasAudio) tags.push('<span class="tag tag-audio">Audio</span>');
      if (r.errorCount > 0) tags.push(`<span class="tag tag-error">${r.errorCount} error(s)</span>`);

      const durStr = r.durationMs ? ` · ${formatDuration(r.durationMs)}` : "";
      const metaSub = `${r.fileSizeKb} KB${durStr}`;
      const tagsHtml = tags.length > 0 ? `<div class="report-tags">${tags.join(" ")}</div>` : "";

      rowsHtml += `
      <tr class="report-row" data-search="${escapeHtml((r.pageTitle + " " + r.pageUrl + " " + r.filename).toLowerCase())}">
        <td>
          <div class="report-title-cell">
            <a href="${r.relativePath}" class="report-link" target="_blank" rel="noopener" title="${escapeHtml(r.pageTitle)}">
              ${escapeHtml(r.pageTitle)}
            </a>
            ${r.pageUrl ? `<a href="${escapeHtml(r.pageUrl)}" class="report-url" target="_blank" rel="noopener">${escapeHtml(r.pageUrl)}</a>` : ""}
            ${tagsHtml}
          </div>
        </td>
        <td class="report-date-cell">
          <time datetime="${r.capturedAt}">${formatDate(r.capturedAt)}</time>
        </td>
        <td class="report-meta-cell">
          <span>${metaSub}</span>
        </td>
        <td class="report-actions-cell">
          <a href="${r.relativePath}" class="btn-sm btn-accent" target="_blank" rel="noopener">Open</a>
          <a href="${r.relativePath}" download="${escapeHtml(r.filename)}" class="btn-sm btn-secondary" title="Download report file">Download</a>
          <button type="button" class="btn-sm btn-secondary btn-copy-url" data-url="${r.relativePath}" title="Copy report URL">Copy URL</button>
        </td>
      </tr>`;
    }
  }

  return `
    <div class="reports-container">
      <div class="reports-toolbar">
        <span class="reports-count" id="reports-count-label">Showing ${countText}</span>
        <input type="text" id="reports-search-input" placeholder="Search reports..." aria-label="Search reports" autocomplete="off">
      </div>
      <div class="reports-table-scroll">
        <table class="reports-table" id="reports-table">
          <thead>
            <tr>
              <th style="width: 44%;">Report / Source</th>
              <th style="width: 20%;">Recorded At</th>
              <th style="width: 14%;">Details</th>
              <th style="width: 22%; text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody id="reports-table-body">
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
    <script>
      (function() {
        var input = document.getElementById("reports-search-input");
        var tbody = document.getElementById("reports-table-body");
        var count = document.getElementById("reports-count-label");
        if (input && tbody) {
          input.addEventListener("input", function(e) {
            var q = (e.target.value || "").toLowerCase().trim();
            var rows = tbody.querySelectorAll(".report-row");
            var visible = 0;
            rows.forEach(function(row) {
              var text = row.getAttribute("data-search") || "";
              if (!q || text.indexOf(q) !== -1) {
                row.style.display = "";
                visible++;
              } else {
                row.style.display = "none";
              }
            });
            if (count) {
              count.textContent = q ? ("Found " + visible + " report" + (visible === 1 ? "" : "s")) : ("Showing " + rows.length + " report" + (rows.length === 1 ? "" : "s"));
            }
          });
        }

        document.addEventListener("click", function(e) {
          var btn = e.target.closest(".btn-copy-url");
          if (!btn) return;
          var rel = btn.getAttribute("data-url");
          var fullUrl = new URL(rel, window.location.href).href;
          function showCopied() {
            var orig = btn.textContent;
            btn.textContent = "Copied!";
            btn.classList.add("btn-copied");
            setTimeout(function() {
              btn.textContent = orig;
              btn.classList.remove("btn-copied");
            }, 2000);
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(fullUrl).then(showCopied).catch(function() {
              fallbackCopy(fullUrl, showCopied);
            });
          } else {
            fallbackCopy(fullUrl, showCopied);
          }
        });

        function fallbackCopy(text, cb) {
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); cb(); } catch (e) {}
          document.body.removeChild(ta);
        }
      })();
    </script>
`;
}

function main() {
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const files = readdirSync(REPORTS_DIR)
    .filter((file) => file.endsWith(".html"))
    .map((file) => parseReportFile(join(REPORTS_DIR, file), file));

  // Sort descending by capture date
  files.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());

  console.log(`Found ${files.length} report(s) in ${REPORTS_DIR}`);

  const tableHtml = buildReportsTableHtml(files);

  if (!existsSync(INDEX_FILE)) {
    throw new Error(`Target index file not found: ${INDEX_FILE}`);
  }

  let indexContent = readFileSync(INDEX_FILE, "utf8");

  if (indexContent.includes(START_MARKER) && indexContent.includes(END_MARKER)) {
    const s = indexContent.indexOf(START_MARKER);
    const e = indexContent.indexOf(END_MARKER, s + START_MARKER.length);
    indexContent = indexContent.slice(0, s + START_MARKER.length) + "\n" + tableHtml + "\n    " + indexContent.slice(e);
  } else {
    // Insert reports section before <!-- ============ FINAL CTA ============ --> or </body>
    const reportsSection = `
<!-- ============ REPORTS ============ -->
<section class="section-pad" id="reports">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">GitHub Pages</span>
      <h2 style="font-size:clamp(28px,3.6vw,42px)">Published Bug Reports</h2>
      <p class="sub">Browse and inspect session recordings uploaded directly from the OpenJam extension.</p>
    </div>
    ${START_MARKER}
${tableHtml}
    ${END_MARKER}
  </div>
</section>
`;
    const targetAnchor = "<!-- ============ FINAL CTA ============ -->";
    if (indexContent.includes(targetAnchor)) {
      indexContent = indexContent.replace(targetAnchor, reportsSection + "\n" + targetAnchor);
    } else {
      const bodyEnd = "</body>";
      indexContent = indexContent.replace(bodyEnd, reportsSection + "\n" + bodyEnd);
    }

    // Add nav link if not present
    if (indexContent.includes('href="#how"') && !indexContent.includes('href="#reports"')) {
      indexContent = indexContent.replace(
        '<a href="#how">How it works</a>',
        '<a href="#how">How it works</a>\n      <a href="#reports">Reports</a>',
      );
    }
  }

  writeFileSync(INDEX_FILE, indexContent, "utf8");
  console.log(`Updated ${INDEX_FILE} successfully with ${files.length} report(s).`);
}

main();
