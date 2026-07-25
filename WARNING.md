# WARNING — Edge Cases & Sync Hazards

This file documents every non-obvious gotcha encountered while building and debugging
`dist/scream.html` (the single-file offline export produced by `go run weave.go`),
as well as architectural sync requirements between files.
It exists so future sessions don't re-discover these the hard way.

---

## 0. `.slide-content` rules must be kept in sync across two CSS files

`css/app.css` styles the editor preview pane. `css/export.css` is a self-contained
stylesheet embedded in the exported HTML — it cannot reference `app.css`.

Both files use `.slide-content` because the same element appears in both contexts.
**Any `.slide-content` rule added to one file must be added to the other.**

Both files carry a `/* SYNC: ... */` comment near the `.slide-content` block as a reminder.

---

## 1. Go regexp replacement destroys JS template literals

**File**: `weave.go` — `processHtml` / `ReplaceAllString`

Go's `regexp.ReplaceAllString` interprets `${name}` in the replacement string as a named
capture-group reference and silently replaces it with the empty string.  Every JS template
literal in the bundled IIFE — `${slidesHtml}`, `${overviewHtml}`, `${HELP_HTML}`, etc. —
was being wiped, causing "empty slide wrappers" crashes at runtime.

**Fix**: use `ReplaceAllLiteralString` when substituting the IIFE bundle into the HTML template.
Never use `ReplaceAllString` with a replacement that comes from arbitrary JS source.

---

## 2. `</script>` inside JS template literals breaks the HTML parser

**File**: `weave.go` — `buildIifeBundle`

`exporter.js` contains literal `</script>` inside template literals (the HTML-generation code).
When that source is inlined into a `<script>` block in the output HTML, the parser treats the
first `</script>` as closing the block, producing "Unexpected end of input".

**Fix**:
```go
iife = strings.ReplaceAll(iife, "</script>", `<\/script>`)
// then add back the one real closing tag at the very end
```
Go's `json.Marshal` already escapes `<`/`>` in JSON strings (used for `SCREAM_ASSETS`), so
that path is safe — only the raw IIFE injection needs the manual escape.

---

## 3. BroadcastChannel fails across file:// → blob: origins

**File**: `js/export-nav.js`

The single-file presenter window is opened as a `blob:null/…` URL.  The editor page lives at
`file://` with an opaque origin.  Chrome treats these as **different origins**, so
`BroadcastChannel` messages are silently never delivered.

Symptoms: presenter window opens with correct DOM but shows no slides; `presenter-ready` message
never arrives; no errors in console.

**Fix**: dual-transport IPC.

- `sendToPresenter(msg)`: tries `presenterWin.postMessage(msg, '*')` first (cross-origin safe),
  then falls back to `channel.postMessage`.
- `sendToAudience(msg)`: tries `window.opener.postMessage(msg, '*')` first, then falls back.
- Both sides listen on **both** `channel.onmessage` and `window.addEventListener('message', …)`.
  Only one transport fires per send, so messages are not doubled.

---

## 4. Stale script listeners from previous present-mode sessions

**Files**: `js/export-nav.js`, `js/annotator.js`

When present mode is entered more than once in the same editor session, scripts injected the
first time (`export-nav.js`, `annotator.js`) remain active because their `document.addEventListener`
calls are never removed.  On the second entry, two copies of every handler fire.

Concrete failure: `D` key toggled draw-mode on then immediately off (two annotator handlers);
stale `channel.onmessage` handlers could inject slides into the wrong DOM.

**Fix**: `isConnected` guard at the top of every document-level handler:
```js
if (!svg.isConnected) return;   // annotator
if (!wrappers[0]?.isConnected) return;  // export-nav
```
Also: register a `{ once: true }` listener for `scream:exit-present` in `export-nav.js` to
close the `BroadcastChannel` when present mode exits, preventing leaks across sessions.

---

## 5. Capture-phase ordering: Escape key in present mode vs annotator

**File**: `js/present.js`

Both the present-mode Escape handler and `annotator.js` use `addEventListener('keydown', …, true)`
(capture phase).  The Escape handler must fire **before** annotator's handler so that it can
check `document.body.classList.contains('draw-mode')` and let annotator exit draw mode first
rather than also tearing down present mode.

**Rule**: register the present-mode Escape listener *before* injecting the annotator `<script>`
tag.  DOM order determines capture-phase dispatch order for the same target.

---

## 6. CSS variables scoped to `#present-overlay`, not `:root`/`body`

**Files**: `css/export.css`, `js/export-nav.js`

The export CSS anchors its custom properties and base styles on `:root, html, body`.  When
the export DOM is injected *inside* an existing page (`#present-overlay`), `body` is the
editor body — those rules apply to the whole editor, not the overlay.  Additionally toggling
`body.light-theme` didn't affect the overlay because the CSS variables were re-declared on
`#present-overlay` itself.

**Fixes applied**:
- `export.css` extends every `:root`, `html, body`, and `body.light-theme` selector with an
  `#present-overlay` variant.
- The L-key light-mode toggle in `export-nav.js` must toggle `#present-overlay.light-theme`,
  not just `body.light-theme`.
- `exitPresent` uses `overlay.className = 'hidden'` (not `classList.remove`) to guarantee
  `light-theme` and any other state classes are wiped completely.

---

## 7. Help overlay Z-index conflict between editor and presenter

**File**: `js/export-nav.js`, `js/present.js`

`export.css` sets `#help-overlay { z-index: 500 }`.  When the export DOM is injected into the
live editor page, that `#help-overlay` is promoted above the editor's own `#help-overlay`,
making `?` show the editor's help (which export.css then covers) rather than the presenter's.

**Fix**:
- Inject a presenter `#help-overlay` *inside* `#present-overlay`.
- Add `body.help-open > #help-overlay { display: none !important }` to the injected style so
  the editor's help overlay is suppressed.
- In `export-nav.js`, change `getElementById('help-overlay')` to
  `querySelector('#present-overlay #help-overlay') || getElementById('help-overlay')` for
  click-outside-to-close targeting.

---

## 8. Presenter window opens the editor URL instead of the presentation

**File**: `js/export-nav.js`

The P-key handler in `export-nav.js` originally did `window.open(window.location.href, …)`.
In-page present mode, `window.location.href` is the editor file URL — opening a second editor,
not a presenter.

**Fix**: before injecting scripts, set `window._presentUrl` to a blob URL of
`buildPresentHtml()` output (with absolute font paths so fonts resolve from `blob:null`).
`export-nav.js` uses `window._presentUrl || window.location.href`.

Blob URLs work for `window.open` even from `file://`.  They do **not** work as `<iframe src>`
or `<iframe srcdoc>` for cross-origin reasons — only `window.open` is safe here.

---

## 9. `document.execCommand('insertText')` is unreliable for multi-char insertion

**File**: `js/editor.js`

The original Enter-key handler used `execCommand('insertText', false, '\n\n# ')` to insert a
new heading.  This worked sometimes but frequently inserted then immediately reverted, leaving
only `#` on the original line.  Root cause: `execCommand` is deprecated and its interaction
with CodeJar's 30 ms debounce + `restore()` is undefined.

**Fix**: manual splice:
```js
jar.save();
const newText = content.slice(0, pos.start) + '\n\n# ' + content.slice(pos.start);
jar.updateCode(newText);
jar.restore({ start: pos.start + 4, end: pos.start + 4 });
```

---

## 10. JS module `import`/`export` stripping must handle re-exports and `from` lines

**File**: `weave.go` — `bundleJs`

The bundler strips `import` and `export` lines with simple string matching.  Edge cases that
must be handled:
- `export { foo, bar }` — named re-exports; strip the whole line.
- `export default function` / `export default class` — keep the declaration, strip `export default`.
- `import '…'` side-effect imports — strip entirely (CSS/asset imports have no meaning in IIFE).
- `export * from '…'` — strip.

Failing to strip an `export` keyword produces a syntax error because the IIFE wrapper is not
an ES module context.  Failing to strip an `import` line leaves a broken `import` statement
that throws at parse time.

---

## 11. `annotatorJs` and `navJs` must NOT go into the IIFE bundle

**File**: `weave.go`

`annotator.js` and `export-nav.js` are injected at **runtime** as raw text (via `SCREAM_ASSETS`),
not at build time.  `present.js` creates `<script>` elements from their text content.

If they are also included in the IIFE bundle, their `document.addEventListener` calls fire
immediately on page load in the editor — before any present-mode DOM exists — and then fire
again when present mode is entered, creating duplicate stale listeners (see §4).

**Rule**: keep `annotator.js` and `export-nav.js` in `SCREAM_ASSETS` only.  Exclude them from
the DFS walk that builds the IIFE.

---

## 12. Font `url()` paths become invalid when CSS is inlined

**File**: `weave.go` — CSS inlining step

When `app.css` (or any CSS with `@font-face`) is inlined into a `<style>` block in the output
HTML, relative `url(../fonts/…)` paths no longer resolve — the HTML has no filesystem context
for relative paths when opened from an arbitrary location.

**Fix**: before inlining, rewrite every `url(…)` that points to a font file to a `data:` URI
(base64-encoded file content).  `weave.go` does this with a regexp + file-read pass over the
CSS source before injecting it.

---

## 13. `SCREAM_ASSETS` JSON values are already HTML-escaped by `json.Marshal`

**File**: `weave.go`

Go's `json.Marshal` escapes `<`, `>`, and `&` to `<`, `>`, `&` in string
values.  This is intentional for safe embedding in HTML.  JS's `JSON.parse` reverses the
escaping transparently.

Do **not** add manual HTML escaping on top of `json.Marshal` output — it will double-escape
and break the values.  The `</script>` escape from §2 applies only to the raw IIFE string,
not to the JSON block.

---

## 14. `--custom-bg-filter` must be set on the parent `.slide-content`, not `.bg-content-wrapper`

**Files**: `js/preview.js`, `js/exporter.js`

The DOM structure for a background-image slide is:

```
.slide-content.layout-bg
  .bg-slice-container
    .bg-slice          ← filter: var(--custom-bg-filter, …) applied here
  .bg-content-wrapper  ← text content lives here
```

`.bg-slice` and `.bg-content-wrapper` are **siblings**.  CSS custom properties only inherit
*downward* through the DOM, not sideways.  Setting `--custom-bg-filter` on `.bg-content-wrapper`
makes it invisible to `.bg-slice`.

**Fix**: set the variable on `el` (the `.slide-content` parent) so it cascades to both children.
