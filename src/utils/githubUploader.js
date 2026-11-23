// GitHub API uploader module for OpenJam reports.
// Encodes HTML string to UTF-8 Base64 and uploads via GitHub Contents API:
// PUT /repos/{owner}/{repo}/contents/docs/reports/{filename}

export const STORAGE_KEY = "openjam_github_config";

/**
 * Safely encodes a UTF-8 string to a Base64 string.
 * Uses TextEncoder and chunked String.fromCharCode to handle arbitrary UTF-8
 * characters (emojis, unicode, special HTML chars) without Latin1 range errors
 * or call-stack size limits on large files.
 *
 * @param {string} str
 * @returns {string} Base64 encoded string
 */
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB chunks
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}

/**
 * Retrieves the saved GitHub configuration from chrome.storage.local.
 * @returns {Promise<{pat: string, owner: string, repo: string, branch: string, prefix: string}>}
 */
export async function getGitHubConfig() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || null;
}

/**
 * Generates the expected public GitHub Pages URL for a given report file.
 * @param {string} owner
 * @param {string} repo
 * @param {string} filename
 * @returns {string}
 */
export function getGitHubPagesUrl(owner, repo, filename) {
  return `https://${owner.toLowerCase()}.github.io/${repo}/reports/${filename}`;
}

/**
 * Uploads an OpenJam HTML report to the configured GitHub repository
 * and copies the public GitHub Pages URL to the clipboard.
 *
 * @param {Object} options
 * @param {string} options.htmlContent - Raw HTML report string
 * @param {string} options.filename - Filename in reports/ (e.g. openjam-2026-11-23T12-00-00.html)
 * @param {Object} [options.config] - Optional config override; if omitted, loads from storage
 * @param {string} [options.commitMessage] - Optional custom commit message
 * @param {boolean} [options.copyToClipboard=true] - Whether to copy the Pages URL to clipboard
 * @returns {Promise<{success: boolean, pagesUrl: string, apiResponse: Object}>}
 */
export async function uploadReportToGitHub({
  htmlContent,
  filename,
  config,
  commitMessage,
  copyToClipboard = true,
}) {
  const cfg = config || (await getGitHubConfig());

  if (!cfg || !cfg.pat || !cfg.owner || !cfg.repo) {
    throw new Error(
      "GitHub configuration is missing or incomplete. Please configure your GitHub PAT, Owner, and Repo in OpenJam Settings.",
    );
  }

  const owner = cfg.owner.trim();
  const repo = cfg.repo.trim();
  const branch = (cfg.branch || "main").trim();
  const pat = cfg.pat.trim();

  // 1. Encode content to UTF-8 Base64
  const base64Content = utf8ToBase64(htmlContent);

  // 2. Prepare PUT payload
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/docs/reports/${encodeURIComponent(filename)}`;
  const message = commitMessage || `Add OpenJam recording: docs/reports/${filename} [skip ci]`;

  const payload = {
    message,
    content: base64Content,
    branch,
  };

  // 3. Upload to GitHub API
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "OpenJam-Extension",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    let details = errorBody.message || response.statusText;
    if (response.status === 401) {
      details = "Invalid GitHub Personal Access Token (401 Unauthorized).";
    } else if (response.status === 404) {
      details = `Repository "${owner}/${repo}" not found or token lacks access (404 Not Found).`;
    } else if (response.status === 409) {
      details = `Conflict: A file named "${filename}" may already exist or branch "${branch}" has conflicting changes.`;
    }
    throw new Error(`GitHub upload failed (${response.status}): ${details}`);
  }

  const apiData = await response.json();
  const pagesUrl = getGitHubPagesUrl(owner, repo, filename);

  // 4. Auto-copy to clipboard
  let copied = false;
  if (copyToClipboard && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(pagesUrl);
      copied = true;
    } catch (clipErr) {
      console.warn("Could not copy URL to clipboard:", clipErr);
    }
  }

  return {
    success: true,
    pagesUrl,
    copied,
    apiResponse: apiData,
  };
}
