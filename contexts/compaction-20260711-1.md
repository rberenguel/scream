# Session Compaction Summary

## User Intent
- Build "Scream" — a minimal 3-pane slide editor where `#` headers are slides, notes stay in the editor
- Feynman-method tool: single word/phrase per slide, maximum friction reduction for teaching prep
- Match preso's Nord/OstrichSans visual style and copy its working conventions

## Contextual Work Summary

### Project Structure
- Created `/Users/ruben/code/scream/` from scratch
- `libs/` is a symlink to `../preso/libs/` (CodeMirror bundle, marked, interact)
- `fonts/` contains OstrichSans (copied from preso) and Phosphor Light (copied from iconer)
- Single CSS file (`css/app.css`), no preso-theme dependency

### Core Parser (`js/parser.js`)
- `parseSlides`: splits markdown on `# ` lines only; everything between headers is "notes"
- `slideAtLine`: finds which slide a cursor line belongs to
- `reorderSlides`: moves a slide block (header + notes) to a new index; ensures blank line separator is always added between blocks on reconstruction

### Editor (`js/editor.js`)
- CodeMirror 6 with oneDark, markdown mode, GFM, line wrapping
- Custom `highlightField` (StateField + Decoration + RangeSetBuilder) highlights the active `#` line based on cursor position — computed per-transaction, no StateEffect needed (not exported by bundle)
- Keymap: `Mod-s` → save, `Mod-o` → open (both fire even when editor focused)
- `goToLine` scrolls editor to a 0-based line number

### Timeline (`js/timeline.js`)
- Renders draggable cards for each slide
- Drag UX: cards are the drop targets; cursor position (top/bottom half) determines insert-before index; single indicator element is moved in DOM rather than static hairlines
- `_handleDrop` normalises "insert before X" to a final `toIndex` after accounting for removal offset

### Preview (`js/preview.js`)
- `renderPreview(title, index, total)`: runs `marked.parseInline(title)` first, then `expandIcons` on the HTML output
- `expandIcons`: replaces `:chat:` or `:ph-chat:` with `<i class="ph-light ph-chat"></i>` — empty element, icon from CSS `::before`
- Font size scaled by `el.textContent.length`: default 11cqi, stepping down to 9/7/5cqi for longer text

### Styling (`css/app.css`)
- 3-column CSS grid: editor | 200px timeline | preview
- Slide preview: `#1a1a1a` background, `#bf616a` text (Nord `--red` = `--h1-color`), `#434c5e` border
- OstrichSans + `text-transform: uppercase` on slide content
- `strong`: `#ff7043` (preso ostrich dark override); `em`: `#ebcb8b` (Nord yellow = `--italic-color`)
- `#slide-content .ph-light`: `text-transform: none !important` to prevent uppercase breaking Phosphor CSS `::before` content
- Editor font: 15px

### Key Bugs Fixed During Session
- Drag whitespace: `reorderSlides` now ensures blank line between blocks when last block had no trailing newline
- Drop indicator: replaced static 2px hairlines with a single dynamically-repositioned element based on card half (top/bottom)
- Icon rendering: `expandIcons` must run AFTER `marked.parseInline` (not before) or marked escapes the HTML tags
- Phosphor approach: icons use compound class `ph-light ph-iconname` with `::before` — NOT ligatures or text content
- `text-transform: uppercase` on slide parent overrides phosphor's `text-transform: none` due to ID specificity — fixed with `!important`

## Files Touched

### Core
- **js/main.js**: App bootstrap, file I/O (showOpenFilePicker / showSaveFilePicker), wires editor/timeline/preview; dirty tracking
- **js/parser.js**: Slide parsing, cursor-to-slide mapping, reorder with whitespace fix
- **js/editor.js**: CodeMirror setup, active-line highlight, Mod-s/Mod-o keymap
- **js/timeline.js**: Drag-to-reorder cards with dynamic drop indicator
- **js/preview.js**: Markdown+icon rendering, font size scaling

### UI
- **css/app.css**: Full app layout, slide styling, Nord color palette, OstrichSans, Phosphor icon sizing
- **index.html**: 3-pane shell, loading overlay, phosphor CSS link, marked.min.js script tag

### Assets
- **fonts/**: OstrichSans-Heavy.otf, OstrichSans-Medium.otf, Inter-Regular.otf, monoid-regular.woff2 (from preso); Phosphor-Light.woff2 + phosphor.css (from iconer)
- **libs → ../preso/libs**: symlink (codemirror-bundle.js, marked.min.js, interact.min.js)

### Docs
- **README.md**: Concept, layout, slide syntax, keyboard shortcuts, how to run (user edited first line)
