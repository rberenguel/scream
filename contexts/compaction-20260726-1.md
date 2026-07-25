# Session Compaction Summary

## User Intent

- Add a CLI tool (`scream.go`) that converts a Scream markdown file to a standalone presentation HTML, equivalent to the browser's "Export HTML" output
- Keep it stdlib-only (no external dependencies, no `go.mod`), with a simple hand-written markdown parser
- Document the CLI's capabilities and limitations in a `SKILL.md` aimed at LLMs using it as a tool

## Contextual Work Summary

### Design Decisions

- No external markdown library: user preferred a simple character-by-character inline parser and line-by-line block parser over pulling in goldmark
- `_italic_` / `__bold__` deliberately omitted — only `*` and `**` supported (sufficient for presentation content, avoids word-boundary ambiguity)
- `//go:embed` used to bake all assets (fonts, CSS, JS) at compile time; no `go.mod` needed since `embed` is stdlib (Go 1.16+)
- Both `weave.go` and `scream.go` coexist as `package main` files in the root; `go run scream.go` and `go run weave.go` each compile only the specified file

### `scream.go` Implementation

- Inline parser: `parseInline` — handles `**bold**`, `*italic*`, `` `code` ``, `![alt](src)`, `[text](url)`, raw HTML pass-through, `&entity;` pass-through
- Block parser: `parseMarkdown` — headings, paragraphs, fenced code, blockquotes, UL/OL lists, HR; used for speaker notes only
- Slide parser: `parseSlides` + `extractClasses` — ports `parser.js` logic including leading `.classname` slide-level class extraction without lookahead (Go regexp has no lookahead support)
- Layout builder: `buildSlideContentHtml` — ports `buildSlideContentEl` from `exporter.js`; handles fill / bg / split / plain layouts via regex img tag parsing
- All output functions mirror `exporter.js`: `buildSlideEl`, `buildNotesEl`, `buildOverviewEl`, `buildPresentationHtml`
- Bug fixed during implementation: Go regexp does not support backreferences (`\1`); HR pattern changed from `^([-*_])\1\1+` to alternation

### `SKILL.md`

- LLM-oriented reference covering: CLI usage, full markdown syntax with limitations called out inline, image layout table, CSS preamble, notes block parser capabilities, built-in snippet list with caveat, "What to avoid" section with concrete LLM failure modes

## Files Touched

### New Files
- **scream.go**: ~380-line stdlib-only Go CLI; `go run scream.go input.md [-o output.html]`; embeds 10 assets at compile time; full presentation HTML generator
- **SKILL.md**: LLM skill reference for the Scream markdown format and CLI

### No other files changed this session
