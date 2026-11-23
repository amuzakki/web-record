// OpenJam build:
// 1. Bundle the rrweb recorder into a classic content script (MV3 forbids
//    remote code, so rrweb ships inside the extension).
// 2. Bundle @rrweb/replay's Replayer into a classic script exposing
//    window.RRWebReplayer — rrweb-player@2.x ships broken dist artifacts (the
//    compiled component never constructs its Replayer; verified across
//    2.0.0/2.0.1 UMD+ESM builds), so OpenJam drives the replay engine directly
//    with its own controller UI (renderer.js mountReplay).
// 3. Emit the engine + its CSS as string constants for inlining into the
//    self-contained HTML export, and as extension files for the viewer page.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";

// --- single-source splicing ------------------------------------------------
// The popup component and the colour palette each have ONE authored home
// (openjam-popup.js, tokens.css). Every other place they appear is a generated
// region between markers, refreshed here so the copies can never drift
// (docs/popup-redesign-fixes/05-component-source-of-truth.md). A hand-edit
// inside a marked region is overwritten on the next build — that is the point.

// Replace the text between `start` and `end` (markers kept) with `body`.
function splice(text, start, end, body, where) {
  const s = text.indexOf(start);
  if (s === -1) throw new Error(`splice: missing marker ${start} in ${where}`);
  const e = text.indexOf(end, s + start.length);
  if (e === -1) throw new Error(`splice: missing marker ${end} after ${start} in ${where}`);
  return text.slice(0, s + start.length) + body + text.slice(e);
}

const TOK_START = "/* tokens:start */";
const TOK_END = "/* tokens:end */";

// The palette lines from tokens.css (declarations only, comments dropped).
const tokenLines = readFileSync("tokens.css", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("--"));

// Two renderings of the same palette: raw CSS for the .css/.html/template-literal
// consumers, and quoted JS array elements for the component's string-array <style>.
const tokensCss = "\n  " + tokenLines.join("\n  ") + "\n  ";
const tokensJsArray = "\n    " + tokenLines.map((l) => JSON.stringify("  " + l) + ",").join("\n    ") + "\n    ";

// Fan the palette out to every consumer between its token markers.
for (const file of ["renderer.js", "viewer.html", "openjam-popup.js", "options.html", "recordings.html"]) {
  if (!existsSync(file)) continue;
  // openjam-popup.js builds its <style> as a JS string-array, so it takes the
  // array-element rendering; the others are raw CSS.
  const body = file === "openjam-popup.js" ? tokensJsArray : tokensCss;
  writeFileSync(file, splice(readFileSync(file, "utf8"), TOK_START, TOK_END, body, file));
}

// Splice the (now palette-refreshed) components into the landing page, and the
// palette into the landing :root. Each component is inlined as a <script>, so
// neutralise `</script` (the sequence that ends script data) before embedding —
// same escaping report-builder.js does when it inlines the component into an
// export (https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements).
const spliceScript = (html, src, start, end, label) =>
  splice(html, start, end, "\n<script>\n" + src.replace(/<\/script/gi, "<\\/script") + "\n</script>\n", label);
// waveform.js is also emitted raw as WAVEFORM_JS below, so read it once here.
const waveformSrc = readFileSync("waveform.js", "utf8");
let landing = readFileSync("docs/index.html", "utf8");
landing = splice(landing, TOK_START, TOK_END, tokensCss, "docs/index.html (:root)");
landing = spliceScript(landing, readFileSync("openjam-popup.js", "utf8"), "<!-- openjam-popup:start -->", "<!-- openjam-popup:end -->", "docs/index.html (component)");
landing = spliceScript(landing, readFileSync("install-cta.js", "utf8"), "<!-- install-cta:start -->", "<!-- install-cta:end -->", "docs/index.html (install-cta)");
landing = spliceScript(landing, waveformSrc, "<!-- oj-waveform:start -->", "<!-- oj-waveform:end -->", "docs/index.html (oj-waveform)");
// Inline the narrated-repro clip as a base64 data URL so the easter egg's
// shape-decode fetch works off disk too (file:// blocks fetch of a sibling
// file). Keeps the page self-contained (docs/CLAUDE.md) — no network egress.
const shiftAudioDataUrl = "data:audio/mpeg;base64," + readFileSync("docs/ah-shit-here-we-go-again.mp3").toString("base64");
landing = splice(landing, "/* shift-audio:start */", "/* shift-audio:end */",
  "\n    var SHIFT_AUDIO_SRC = " + JSON.stringify(shiftAudioDataUrl) + ";\n    ", "docs/index.html (shift-audio)");
writeFileSync("docs/index.html", landing);
console.log("spliced palette into 4 consumers + component + install-cta + oj-waveform + inlined shift-audio into docs/index.html");

// Content scripts, one bundle each: the MAIN-world rrweb recorder, the
// MAIN-world page probe (console/error/fetch/XHR for the inject lane, #48), and
// the isolated-world relay that carries both to the background worker (MAIN
// world has no chrome.* APIs).
for (const name of ["rrweb-recorder", "page-probe", "rrweb-relay"]) {
  await build({
    entryPoints: ["src/" + name + ".js"],
    bundle: true,
    format: "iife",
    minify: true,
    outfile: "dist/" + name + ".js",
    logLevel: "info",
  });
}

// Bundle-time patch of one condition in rrweb-snapshot's rebuild (inlined into
// @rrweb/replay). Two deliberate changes in one string:
//  1. Upstream bug (#43): for an <img> with both srcset and rr_dataURL, the "back up
//     the srcset" branch matches EVERY attribute name, so alt/class/style/id are
//     swallowed and the image replays unstyled at natural size. Fix: `name === "srcset"`.
//     Upstream: https://github.com/rrweb-io/rrweb/issues/1937, fix PR
//     https://github.com/rrweb-io/rrweb/pull/1938. Delete this half once @rrweb/replay
//     ships the fix; the match guard below will say so.
//  2. OpenJam divergence, keep even after 1 is upstreamed: `src` also goes to the
//     backup branch, so an http URL or a data: placeholder never lands on the replay
//     element and rrweb's rr_dataURL branch (which records rrweb-original-src) stays
//     in charge. Guarded by the currentSrc assertion in the #43 e2e.
const RRWEB_SRCSET_BUG = 'tagName === "img" && n2.attributes.srcset && n2.attributes.rr_dataURL';
const RRWEB_SRCSET_FIX = 'tagName === "img" && (name === "srcset" || name === "src") && n2.attributes.srcset && n2.attributes.rr_dataURL';

// Upstream bug: assertRebuildTargetAllowed rejects rebuilding iframes on subsequent full
// snapshots (e.g. on navigation) because document.open() replaces the Document instance,
// losing the weak reference in sandboxedRebuildDocuments. Fix: trust any supported sandboxed iframe
// and re-add its document.
const RRWEB_REBUILD_TARGET_BUG = 'if (sandboxedRebuildDocuments.has(options.doc) && isSupportedSandboxedIframe(win.frameElement))';
const RRWEB_REBUILD_TARGET_FIX = 'if (isSupportedSandboxedIframe(win.frameElement)) { sandboxedRebuildDocuments.add(options.doc); return; }\n  if (sandboxedRebuildDocuments.has(options.doc))';

// Safe full snapshot rebuild into sandboxed iframe:
// Always allow rebuild in our sandboxed iframe without script execution risk.
const RRWEB_UNSAFE_ALLOW_BUG = 'UNSAFE_allowUnprotectedRebuild: this.UNSAFE_replayCanvas';
const RRWEB_UNSAFE_ALLOW_FIX = 'UNSAFE_allowUnprotectedRebuild: true';

// Clear document before full snapshot rebuild to avoid HierarchyRequestError:
// In sandboxed iframes without allow-scripts, doc.open() is a no-op and does not clear
// existing children (doctype & documentElement). We must explicitly remove them so appending
// the new snapshot root does not throw "Only one element on document allowed".
const RRWEB_REBUILD_SNAPSHOT_CLEAR_BUG = `  rebuildFullSnapshot(event, isSync = false) {
    if (!this.iframe.contentDocument) {
      return this.warn("Looks like your replayer has been destroyed.");
    }`;
const RRWEB_REBUILD_SNAPSHOT_CLEAR_FIX = `  rebuildFullSnapshot(event, isSync = false) {
    if (!this.iframe.contentDocument) {
      return this.warn("Looks like your replayer has been destroyed.");
    }
    try {
      const doc = this.iframe.contentDocument;
      while (doc && doc.firstChild) {
        doc.removeChild(doc.firstChild);
      }
    } catch (e) {}`;

const RRWEB_REBUILD_DOC_CLEAR_BUG = `  if (n2.type === NodeType$3.Document) {
    doc.close();
    doc.open();`;
const RRWEB_REBUILD_DOC_CLEAR_FIX = `  if (n2.type === NodeType$3.Document) {
    try {
      while (doc && doc.firstChild) {
        doc.removeChild(doc.firstChild);
      }
    } catch (e) {}
    try { doc.close(); } catch (e) {}
    try { doc.open(); } catch (e) {}`;

const RRWEB_REBUILD_APPEND_CHILD_BUG = `      } else if (n2.type === NodeType$3.Document && childN.type == NodeType$3.Element) {
        const htmlElement = childNode;
        let body = null;
        htmlElement.childNodes.forEach((child) => {
          if (child.nodeName === "BODY") body = child;
        });
        if (body) {
          htmlElement.removeChild(body);
          node2.appendChild(childNode);
          htmlElement.appendChild(body);
        } else {
          node2.appendChild(childNode);
        }
      } else {
        node2.appendChild(childNode);
      }`;
const RRWEB_REBUILD_APPEND_CHILD_FIX = `      } else if (n2.type === NodeType$3.Document && childN.type == NodeType$3.Element) {
        const htmlElement = childNode;
        let body = null;
        htmlElement.childNodes.forEach((child) => {
          if (child.nodeName === "BODY") body = child;
        });
        if (body) {
          htmlElement.removeChild(body);
          if (node2.documentElement) node2.documentElement.replaceWith(childNode);
          else node2.appendChild(childNode);
          htmlElement.appendChild(body);
        } else {
          if (node2.documentElement) node2.documentElement.replaceWith(childNode);
          else node2.appendChild(childNode);
        }
      } else if (n2.type === NodeType$3.Document && childN.type == NodeType$3.DocumentType) {
        if (node2.doctype) node2.doctype.replaceWith(childNode);
        else node2.appendChild(childNode);
      } else {
        node2.appendChild(childNode);
      }`;

// Reset scroll on full snapshot rebuild
const RRWEB_SCROLLTO_BUG = "(_a2 = this.iframe.contentWindow) == null ? void 0 : _a2.scrollTo(event.data.initialOffset);";
const RRWEB_SCROLLTO_FIX = `try {
              const offset = event.data.initialOffset || { left: 0, top: 0 };
              if (this.iframe.contentWindow) {
                this.iframe.contentWindow.scrollTo(offset.left || 0, offset.top || 0);
              }
              if (this.iframe.contentDocument && this.iframe.contentDocument.documentElement) {
                this.iframe.contentDocument.documentElement.scrollTop = offset.top || 0;
                this.iframe.contentDocument.documentElement.scrollLeft = offset.left || 0;
              }
            } catch (e) {}`;

// Upstream bug: waitForStylesheetLoad pauses the state machine on pending stylesheets,
// but the pause listener overwrites beforeLoadState to "paused". The resume timer then
// checks beforeLoadState.matches("playing"), which is always false, freezing the replay.
const RRWEB_STYLESHEET_PAUSE_BUG = `      if (unloadSheets.size > 0) {
        this.service.send({ type: "PAUSE" });
        this.emitter.emit(ReplayerEvents.LoadStylesheetStart);
        timer = setTimeout(() => {
          if (beforeLoadState.matches("playing")) {
            this.play(this.getCurrentTime());
          }
          timer = -1;
          unsubscribe();
        }, this.config.loadTimeout);
      }`;
const RRWEB_STYLESHEET_PAUSE_FIX = `      if (unloadSheets.size > 0) {
        const wasPlaying = beforeLoadState.matches("playing");
        this.service.send({ type: "PAUSE" });
        this.emitter.emit(ReplayerEvents.LoadStylesheetStart);
        timer = setTimeout(() => {
          if (wasPlaying) {
            this.play(this.getCurrentTime());
          }
          timer = -1;
          unsubscribe();
        }, this.config.loadTimeout || 500);
      }`;

// Resilience: wrap timer action dispatch in try/catch so an unexpected DOM exception
// in an individual event never permanently crashes the requestAnimationFrame timer loop.
const RRWEB_TIMER_ACTION_BUG = `      if (this.timeOffset >= action.delay) {
        this.actions.shift();
        action.doAction();
      }`;
const RRWEB_TIMER_ACTION_FIX = `      if (this.timeOffset >= action.delay) {
        this.actions.shift();
        try {
          action.doAction();
        } catch (e) {
          console.warn("[rrweb] action error on event:", e);
        }
      }`;

let rrwebPatchesApplied = {
  srcset: false,
  rebuildTarget: false,
  unsafeAllow: false,
  rebuildSnapshotClear: false,
  rebuildDocClear: false,
  rebuildAppendChild: false,
  scrollTo: false,
  stylesheetPause: false,
  timerAction: false,
};
const patchRrwebRebuild = {
  name: "patch-rrweb-rebuild",
  setup(b) {
    b.onLoad({ filter: /@rrweb[/\\]replay[/\\]dist[/\\]replay\.js$/ }, (args) => {
      let contents = readFileSync(args.path, "utf8");

      for (const [bug, fix, key] of [
        [RRWEB_SRCSET_BUG, RRWEB_SRCSET_FIX, "srcset"],
        [RRWEB_REBUILD_TARGET_BUG, RRWEB_REBUILD_TARGET_FIX, "rebuildTarget"],
        [RRWEB_UNSAFE_ALLOW_BUG, RRWEB_UNSAFE_ALLOW_FIX, "unsafeAllow"],
        [RRWEB_REBUILD_SNAPSHOT_CLEAR_BUG, RRWEB_REBUILD_SNAPSHOT_CLEAR_FIX, "rebuildSnapshotClear"],
        [RRWEB_REBUILD_DOC_CLEAR_BUG, RRWEB_REBUILD_DOC_CLEAR_FIX, "rebuildDocClear"],
        [RRWEB_REBUILD_APPEND_CHILD_BUG, RRWEB_REBUILD_APPEND_CHILD_FIX, "rebuildAppendChild"],
        [RRWEB_SCROLLTO_BUG, RRWEB_SCROLLTO_FIX, "scrollTo"],
        [RRWEB_STYLESHEET_PAUSE_BUG, RRWEB_STYLESHEET_PAUSE_FIX, "stylesheetPause"],
        [RRWEB_TIMER_ACTION_BUG, RRWEB_TIMER_ACTION_FIX, "timerAction"],
      ]) {
        const parts = contents.split(bug);
        if (parts.length !== 2) throw new Error(`rrweb ${key} patch: expected 1 match, found ${parts.length - 1} in ${args.path}`);
        contents = parts.join(fix);
        rrwebPatchesApplied[key] = true;
      }

      return { contents, loader: "js" };
    });
  },
};

await build({
  stdin: {
    contents: 'import { Replayer } from "@rrweb/replay";\nwindow.RRWebReplayer = Replayer;\n',
    resolveDir: process.cwd(),
    sourcefile: "replay-engine-entry.js",
  },
  bundle: true,
  format: "iife",
  minify: true,
  outfile: "dist/rrweb-replay.js",
  logLevel: "info",
  plugins: [patchRrwebRebuild],
});
if (!Object.values(rrwebPatchesApplied).every(Boolean)) {
  throw new Error("one or more rrweb patches never ran: " + JSON.stringify(rrwebPatchesApplied));
}

const engine = readFileSync("dist/rrweb-replay.js", "utf8");
const engineCss = readFileSync("node_modules/@rrweb/replay/dist/style.min.css", "utf8")
  .replace(/\/\*# sourceMappingURL=.*?\*\//g, "")
  .trim();

// Both get inlined into an HTML <script>/<style>. The export neutralises
// </script>, but <!-- or <script would shift the HTML parser into a state that
// swallows the closing tag (https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements).
if (/<\/script|<script|<!--/i.test(engine)) {
  throw new Error("replay engine bundle contains HTML-breaking sequences (<script, </script or <!--); review export inlining before shipping");
}

writeFileSync("dist/rrweb-replay.css", engineCss);
mkdirSync("src/generated", { recursive: true });
writeFileSync(
  "src/generated/player-assets.js",
  "// Generated by build.mjs — do not edit. Engine: @rrweb/replay@2.0.1.\n" +
    "export const ENGINE_IIFE = " + JSON.stringify(engine) + ";\n" +
    "export const ENGINE_CSS = " + JSON.stringify(engineCss) + ";\n" +
    "export const WAVEFORM_JS = " + JSON.stringify(waveformSrc) + ";\n",
);
console.log("wrote src/generated/player-assets.js, dist/rrweb-replay.{js,css}");

if (existsSync("options.html")) {
  copyFileSync("options.html", "dist/options.html");
}
if (existsSync("options.js")) {
  copyFileSync("options.js", "dist/options.js");
}
if (existsSync("recordings.html")) {
  copyFileSync("recordings.html", "dist/recordings.html");
}
if (existsSync("recordings.js")) {
  copyFileSync("recordings.js", "dist/recordings.js");
}
