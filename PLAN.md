# Scream: CodeJar + Single-File Inliner Plan

## Goals

1. Replace CodeMirror (2.7 MB bundle) with a compact editor (CodeJar ~6 KB)
2. Write a `weave.py` (or `weave.go`) that produces a **single `scream.html`** with all
   assets inlined — fonts, CSS, JS, icons — zero external deps
3. `scream.html` is a fully functional editor (three-pane, tabs, export) that
   also has a built-in present mode (can switch into a full-screen presentation
   view of its current content without opening a second window)
4. The existing PWA (`index.html` served via a web server) stays intact and
   unchanged in behaviour; the weave script is an additional build step

---

## Current state snapshot

| File | Size | Notes |
|------|------|-------|
| `libs/codemirror-bundle.js` | 2.7 MB | the main thing to kill |
| `libs/marked.min.js` | 56 KB | kept — used in editor + export |
| `libs/interact.min.js` | 181 KB | kept — drag-to-reorder timeline |
| `libs/highlight.min.js` | 125 KB | kept but optional in single-file |
| fonts total | ~660 KB | base64 in export already; same for weave |
| icon lists (`phosphor-icons.js`, `iconoir-icons.js`) | ~100 KB src | kept |

JS uses ES modules with `import`/`export`. `index.html` uses an importmap to
alias `CodeMirrorBundle` → `./libs/codemirror-bundle.js`.

---

## Phase 1 — Replace CodeMirror with CodeJar

### Why CodeJar is a good fit

- ~6 KB, zero deps
- Uses `<pre><code contenteditable>` — browser provides native undo/redo
- Accepts a highlight callback (we can wire Highlight.js or skip syntax colouring)
- Simple API: `jar = CodeJar(el, highlighter)` / `jar.updateCode(str)` /
  `jar.onUpdate(cb)` / `jar.toString()`

### What needs reimplementing

| Feature | CodeMirror had | CodeJar plan |
|---------|----------------|--------------|
| History | built-in | browser native (`contenteditable`) |
| Keyboard shortcuts | `keymap.of([…])` | `keydown` listener on container |
| Enter on `# ` line | custom command | same, in keydown handler |
| Tab → insert `\t` | keymap | `execCommand('insertText', …)` or manual |
| Line wrapping | extension | CSS `white-space: pre-wrap` |
| Icon autocomplete | `autocompletion()` | small custom dropdown widget |
| Active-slide highlight | StateField + Decoration | CSS class on overlay or line `data-` attr |
| `goToLine(n)` | `scrollIntoView` | count `\n` chars, `setSelectionRange` on textarea, or walk text nodes |

### `editor.js` public API stays the same

```js
export function setupEditor(container, initialDoc, callbacks) { … }
export function setDoc(text) { … }
export function getDoc() { … }
export function goToLine(n) { … }
export function placeCursorAtEnd() { … }
```

Only the internals change. `main.js` and everything else is untouched.

### Vendor CodeJar

Download `codejar.js` (~6 KB) into `libs/codejar.js`. No CDN at runtime.
Remove `libs/codemirror-bundle.js` and the importmap from `index.html`.

### Active-slide highlight approach

CodeJar fires `onUpdate` after every change. In that callback (already called
in `main.js` as `handleEditorUpdate`) we have the cursor line. We can expose a
`setHighlightedLine(n)` function in `editor.js` that walks the `<code>` element
line-nodes and toggles a CSS class. Simple, no framework needed.

---

## Phase 2 — Refactor JS for inlineability

The inliner needs to bundle ES modules. The strategy is a **minimal local
bundler** (not tree-shaking, just resolution):

- All imports in this codebase are either:
  - local: `import { foo } from './bar.js'`
  - formerly CodeMirror (gone after Phase 1)
  - `libs/` scripts loaded as plain `<script>` tags (not modules)
- After Phase 1 there are **no npm/CDN imports at all** in the module graph

### Bundling approach

The weave script walks `js/main.js`, resolves each local import recursively
(depth-first, topological), strips `import` and `export` keywords, and
concatenates the result wrapped in an IIFE:

```
(function() {
  // --- parser.js ---
  function parseSlides(...) { ... }
  // --- preview.js ---
  ...
  // --- main.js (last) ---
  ...
})();
```

Rules:
- `export function foo` → `function foo` (strip `export`)
- `export { foo, bar }` → delete line
- `export default …` → keep expression, assign to a local var
- `import { foo, bar } from './baz.js'` → delete line (already inlined above)
- Circular dep guard: if a file is already seen, skip it

This is ~50 lines of Python/Go and handles 100 % of the cases in this codebase.

### What stays as `<script>` (non-module)

`marked.min.js`, `interact.min.js`, `highlight.min.js`, `codejar.js` — these
expose globals (`marked`, `Interact`, `hljs`, `CodeJar`). They are simply
inlined as-is inside `<script>` blocks before the IIFE bundle.

---

## Phase 3 — `weave.py` (or `weave.go`)

### Input / output

```
python weave.py              # reads project, writes dist/scream.html
python weave.py --out scream.html
```

### Steps

1. **Parse `index.html`** (string ops / regex, no HTML parser needed — the
   structure is stable)
2. **Inline CSS** — for each `<link rel="stylesheet" href="…">`:
   - Read the CSS file
   - Patch any `url(./foo.woff2)` → `url("data:font/woff2;base64,…")`
   - Emit as `<style>…</style>`
3. **Inline plain scripts** — for each `<script src="libs/…">`:
   - Read and emit as `<script>…</script>`
4. **Bundle module graph** — for `<script type="module" src="js/main.js">`:
   - Run the local bundler (topological import resolution)
   - Emit as `<script>…</script>` (no `type="module"` needed)
5. **Remove** `<script type="importmap">`, SW registration block,
   `<link rel="manifest">`, `<link rel="icon">` (or inline the favicon)
6. **Inject present-mode integration** (see Phase 4)
7. Write output

### Font inlining

All fonts referenced by CSS `url()` are base64-encoded at weave time. The
`exporter.js` already does this at runtime via `fetchAsBase64()`; the weave
script does the same at build time with Python's `base64` module.

Estimated output size: ~1.5 MB (dominated by fonts + icon lists). Acceptable
for a local tool; can optionally strip icons or compress with gzip later.

---

## Phase 4 — Built-in present mode in `scream.html`

The exported standalone HTML (from "Export HTML") is a separate file with its
own presentation runtime. The `scream.html` editor already has a preview pane
but no full-screen presentation mode of its own.

### Addition: inline presentation view

Add a `#present-view` div (hidden by default) to `index.html` that reuses the
slide rendering logic from `exporter.js`/`preview.js`. Key bindings:

- `P` in the editor (already opens a new window) — **change**: instead toggle
  the `#present-view` overlay within the same page (no popup needed for
  single-file use; keep the popup path for the PWA)
- `Escape` exits back to editor
- `← →` / `Space` navigate slides

This is already ~80 % implemented in `js/export-nav.js`. We extract a
`PresentMode` object that both the weave output and the PWA can use.

### Auto-detect presentation intent

If `scream.html` is opened with `?present` in the URL, or a `#present` hash,
and localStorage has a draft, auto-enter present mode. This covers the "kiosk"
use-case where you e-mail yourself the scream.html and want to present straight
from the iPhone.

---

## Phase 5 — File load/save in single-file mode

- **Save**: File System Access API (`showSaveFilePicker`) works fine in a
  `file://` context on desktop. On iOS it falls back to `navigator.share` /
  blob download — same as today.
- **Open**: `showOpenFilePicker` / `<input type="file">` — both work from
  `file://`. The loaded `.md` content goes into the editor exactly as today.
- **Export**: `exporter.js` uses `fetch('./fonts/…')` which **breaks** in
  `file://` context (no server). Fix: the weave script pre-bakes the font
  base64 strings into the bundle as JS constants, so `exporter.js` reads them
  from variables instead of fetching. A small shim (`FONTS.ostrichHeavy`, etc.)
  switches between fetch-at-runtime (PWA) and pre-baked constants
  (single-file).

---

## Phase 6 — PWA stays intact

After all phases:
- `index.html` + `sw.js` + `manifest.json` → unchanged PWA, works as before
- `libs/codejar.js` replaces `libs/codemirror-bundle.js` (the only JS change
  visible to the PWA)
- `dist/scream.html` is the single-file artifact produced by `weave.go`
- SW cache list in `sw.js` drops `codemirror-bundle.js`, adds `codejar.js`

---

## Session plan

| Session | Deliverable | Status |
|---------|-------------|--------|
| **A** | PLAN.md written, codebase understood | ✅ done |
| **B** | Phase 1: `editor.js` rewritten for CodeJar, PWA works without CodeMirror | ✅ done |
| **C** | Phase 4 (partial): present-mode overlay in `index.html`; CSS scoping; wiring in `main.js` | ✅ done |
| **D** | Phase 4 (complete): `present.js` implemented; all present-mode keys working | ✅ done |
| **E** | Phase 5: font-baking shim in `exporter.js` for `file://` context | ✅ done |
| **F** | Phase 2 + 3: `weave.go` written (`go run weave.go`), produces working `dist/scream.html` | ✅ done |
| **G** | Phase 6: SW cache update, version bump, end-to-end test | — |

## Sessions E + F — completed changes

### Session E — Font-baking shim

- `js/exporter.js` — added `_loadExportAssets()`: checks `window.SCREAM_ASSETS` first, falls back to `fetch()` for PWA; refactored `exportPresentation` and `buildPresentHtml` to use it
- `js/present.js` — `enterPresent` uses `SCREAM_ASSETS`-guarded ternaries instead of direct `fetch()` calls for `export.css`, `export-nav.js`, `annotator.js`
- `window.SCREAM_ASSETS` contract: `{ ostrichHeavy, ostrichMed, phosphorWoff2, phosphorCss, iconoirWoff2, iconoirCss, faviconB64, annotatorJs, exportCss, navJs }` — fonts as data URIs, CSS/JS as raw text

### Session F — `weave.go`

- `weave.go` — new file at project root; `go run weave.go [--out path]`, default `dist/scream.html`; inlines CSS (base64 font URLs), marked.min.js, SCREAM_ASSETS block, IIFE bundle from ES module graph
- Bug fixed: `ReplaceAllString` was treating `${varName}` in the IIFE as regexp capture group references, silently erasing all template literal interpolations; fixed with `ReplaceAllLiteralString`
- Bug fixed: `</script>` inside `exporter.js` template literals closed the IIFE block early; fixed with `strings.ReplaceAll(iife, "</script>", "<\/script>")` + restore final tag

### Sessions E+F — `export-nav.js` overhaul

- `js/export-nav.js` — replaced BroadcastChannel-only IPC with dual-transport: `sendToPresenter` tries `presenterWin.postMessage('*')` first (works cross-origin), `sendToAudience` tries `window.opener.postMessage('*')` first; BroadcastChannel kept as fallback for same-origin cases
- Root cause: `blob:null` origin (presenter window) ≠ `file://` unique origin (editor window) → BroadcastChannel messages never arrived; `window.postMessage` has no origin restriction with `'*'`
- Both sides now listen on both transports (`channel.onmessage` + `window.addEventListener('message', …)`); only one fires per message since `sendTo*` helpers use one or the other

---

## Session D — completed changes

### What was implemented

- `js/present.js` — full implementation of `enterPresent`, `exitPresent`, `isPresentActive`:
  - Fetches `export.css`, `export-nav.js`, `annotator.js` and builds presenter window HTML in parallel
  - Injects `export.css` into `<head>` as `#present-export-css` (cleanly removed on exit); adds `body.help-open > #help-overlay { display: none !important }` to suppress the editor's help overlay
  - Builds slide/notes/overview HTML via `buildSlideEl`/`buildNotesEl`/`buildOverviewEl` and injects into `#present-overlay` along with presenter `#help-overlay` content, `#anno-svg`, `#blackout`, `#draw-indicator`
  - Sets `window._startSlide = startIndex` and `window._presentUrl` (blob URL of full standalone HTML with absolute font paths) before injecting scripts
  - Registers Escape handler in **capture phase before script injection** so it fires before annotator (which also uses capture); skips if `help-open` or `draw-mode` is active
  - `exitPresent`: dispatches `scream:exit-present`, removes style tag, clears overlay innerHTML, resets `overlay.className = 'hidden'`, restores `document.body.className`, revokes blob URL

- `js/export-nav.js` — four additions to the audience branch:
  - `window._presentUrl || window.location.href` for the P-key presenter window open
  - `isConnected` guard on `channel.onmessage` (was missing; stale handlers caused blank-slide bug on re-entry)
  - `isConnected` guard on document click handler (same reason)
  - `document.addEventListener('scream:exit-present', () => channel.close(), { once: true })` — closes stale BroadcastChannels on exit
  - `#present-overlay.light-theme` toggled alongside `body.light-theme` for L key (CSS variables anchored on the overlay element need the class there too)
  - `querySelector('#present-overlay #help-overlay') || getElementById('help-overlay')` so the presenter help overlay (injected inside `#present-overlay`) is used for click-outside-to-close

- `js/annotator.js` — `if (!svg.isConnected) return` added at top of document keydown handler (capture phase); without this, stale annotator instances double-toggled `draw-mode` on re-entry making D key appear broken

---

## Session B — completed changes

- `libs/codejar.js` — CodeJar 4.3.0 (16 KB, replaces 2.7 MB CodeMirror bundle)
- `libs/codejar-cursor.js` — cursor position helpers
- `js/editor.js` — full rewrite: CodeJar API, custom markdown highlighter (headings,
  fences, lists, quotes, active-slide accent), keyboard shortcuts, Enter-on-`# `-line,
  icon autocomplete dropdown, click-to-navigate-slide (with preamble guard),
  `goToLine`, `placeCursorAtEnd`
- `css/app.css` — replaced all `cm-*` rules; added `.codejar-editor`, syntax highlight
  classes, fence body/CSS styles, autocomplete dropdown with matching thin scrollbar
- `index.html` — removed `<script type="importmap">`, removed stale ⌘E hint
- `sw.js` — swapped cache entries (added codejar, iconoir fonts; removed codemirror),
  bumped to `scream-v0.4.0`
- `manifest.json` — bumped to `0.4.0`

### Deliberate omissions / next-session notes
- `Ctrl-E` removed from editor keymap (kept readline binding); export via status-bar
  button and mobile menu only
- Syntax highlighting for inline markdown (bold/italic/code spans) not added — the
  per-line approach would need a small inline parser; defer to later if desired
- Phase 4 (present-mode overlay) and Phase 5 (font-baking) are prerequisites for
  Session E (weave.go)

---

## Decisions (resolved)

1. **Syntax highlighting in editor**: Investigate what CodeJar's own examples
   do — it supports a highlight callback, so we should see what looks reasonable
   with the already-vendored `highlight.min.js` (or a tiny custom pass). Decide
   during Session B once we see CodeJar in action.

2. **Icon autocomplete**: Keep and reimplement as a custom dropdown widget.
   Slightly fiddlier with `contenteditable` than with CodeMirror, but doable.
   Defer to Session B or a dedicated sub-session.

3. **Weave language**: **Go** — `go run weave.go` works with zero build step,
   no library hell, produces clean output. Single-file Go script.

4. **Output path**: **`dist/scream.html`** — add `dist/` to `.gitignore`.
