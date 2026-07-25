# Scream — LLM skill reference

Scream is a markdown-to-presentation tool. Every `# ` line is a slide. Everything else is
speaker notes (never visible in the presentation).

## CLI

```bash
go run scream.go talk.md            # produces talk.html next to the input file
go run scream.go talk.md -o out.html
```

Run from the scream project root (assets are embedded at compile time). Requires Go 1.16+.

## File format

```
[optional CSS preamble block]

# Slide one title

Optional notes / speaker text here.
Any markdown. Never shown in presentation.

# Slide two title

More notes.
```

### Rules

- A slide starts with `# ` (hash, space). Any number of slides in one file.
- Everything between two `# ` lines is speaker notes — written in markdown, rendered in the
  notes panel, invisible in the main presentation.
- A CSS preamble (see below) may appear before the first `# ` line.

---

## Slide title syntax

The title is the text after `# ` on a slide line. It supports:

### Inline markdown (subset)

| Input | Output |
|-------|--------|
| `**text**` | bold (rendered in Nord orange) |
| `*text*` | italic (rendered in Nord yellow) |
| `` `code` `` | inline code |
| `[text](url)` | hyperlink |
| `![alt](url)` | image (triggers layout; see Image layouts) |

**Limitations vs. standard markdown:**
- `_italic_` and `__bold__` are NOT supported — use `*` and `**` only.
- Nested brackets in link text or alt text are not supported.
- No link title attributes: `[text](url "title")` will not parse correctly.
- Inline HTML is passed through as-is (e.g. `<br>` works).

### Literal line break

Use `\n` (backslash-n) inside a title to force a line break:

```markdown
# First line\nSecond line
```

### Icons

```markdown
# :ph-rocket: Launch     ← Phosphor Light icon
# :in-home:  Home        ← Iconoir icon
# :star:                 ← bare name defaults to Phosphor
```

Browse icons at https://phosphoricons.com (prefix `ph-`) and https://iconoir.com (prefix `in-`).

### Inline spans

Wrap text in `.classname { content }` to apply a CSS class to a `<span>`:

```markdown
# Hello .red { world }
# .large { BIG } and normal text
# See the .a { docs } for details
```

- Content inside `{}` can contain markdown and icons.
- The built-in class `.a` renders text in dark green — useful for referencing URLs visually.
- Classes must be defined in the CSS preamble (or be built-in like `.a`).

### Slide-level classes

Prefix the title with one or more `.classname` tokens to apply classes to the whole slide wrapper:

```markdown
# .no-num Hidden from numbering
# .no-num .dark-fade Stylised divider
```

- Classes are stripped from the visible title.
- Do NOT follow `.classname` immediately with `{` — that is an inline span, not a slide class.
- Built-in slide class: `.no-num` hides the slide number badge.

---

## Image layouts

Place an image anywhere in the slide title. The alt text determines the layout.

| Syntax | Layout |
|--------|--------|
| `![bg](url)` | Full-bleed background — image dimmed and blurred, text on top |
| `![bg brightness(60%) blur(2px)](url)` | Background with custom CSS filter string |
| `![bg .classname]()` | Background layer gets a CSS class (gradient, etc.); no image required |
| `![left](url) text` | 50/50 split — image left, text right |
| `![right](url) text` | 50/50 split — image right, text left |
| `![anything](url)` *(lone image, no other text)* | Simple fill, no overlay |

Multiple `![bg]()` images on one slide produce a vertically sliced background.

Local images work: `![bg](backgrounds/myfile.jpg)` — the `backgrounds/` folder is a
convenient convention.

---

## CSS preamble

A fenced `css` block before the first `# ` line is extracted and inlined into the export.
Use it to define custom classes used by inline spans, slide-level classes, or background layers.

````markdown
```css
.red   { color: #bf3030 }
.large { font-size: 14cqi }

.warm-grad {
  background: linear-gradient(135deg, #1a0800, #3d1a00);
}
```

# First slide
````

**Font-size units:** use `cqi` (container query inline size) — slides are container contexts.
`14cqi` ≈ 14% of the slide width. This scales correctly at all presentation sizes.

**Background classes:** when using `![bg .classname]()`, the class is applied to the
`.bg-slice` div. Use `::after` pseudo-elements for overlays:

```css
.vignette::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.65) 100%);
  pointer-events: none;
}
```

---

## Notes markdown (block parser)

Speaker notes support a larger subset of markdown than titles:

- Paragraphs (blank-line separated)
- ATX headings: `# H1`, `## H2`, … `###### H6`
- Unordered lists: `- item`, `* item`, `+ item`
- Ordered lists: `1. item`, `2. item`
- Fenced code blocks: ` ```lang … ``` `
- Blockquotes: `> text`
- Horizontal rules: `---`, `***`, `___`
- All inline syntax from the title parser above

**Limitations:**
- No setext headings (`===` / `---` underline style).
- No nested lists (indented sub-items are dropped).
- No table syntax.
- No definition lists.
- No footnotes.
- Inline HTML is passed through as-is.

---

## Built-in CSS snippets (autocomplete in the editor)

These classes are available without defining them in the preamble — they are part of the
default snippet set and work out of the box in the CLI export too, as long as you declare them
in the preamble:

**Background layer classes** (use with `![bg .name]()`):
`vignette` · `spotlight` · `warm-grad` · `cool-grad` · `dark-fade`

**Inline text classes** (use with `.name { content }`):
`highlight` · `tag` · `box` · `big` · `small` · `mono` · `muted` · `warn` · `err` · `ok` ·
`upper` · `underline`

> Note: these snippets are only built-in in the browser editor autocomplete. For `scream.go`
> CLI output you must define them explicitly in the CSS preamble.

---

## Generating presentations as an LLM

Preferred approach:

1. Write the markdown file with one idea per slide.
2. Use `# ` lines for slide titles only — keep them short and punchy.
3. Put all elaboration, references, and caveats in the notes below the `# ` line.
4. Use `**bold**` for emphasis, `*italic*` for softer stress.
5. Use `:ph-icon:` names for visual punctuation — prefer simple names (`star`, `check`,
   `warning`, `info`, `rocket`, `lightning`).
6. Prefer `![bg .warm-grad]()` (CSS class) over `![bg](url)` (remote image) to avoid
   external dependencies in the output.
7. Define all custom classes in a `css` preamble block.
8. Run `go run scream.go talk.md` from the scream project root to produce `talk.html`.

### What to avoid

- Do not use `_italic_` or `__bold__` — use `*` and `**`.
- Do not put `# ` (hash space) anywhere inside notes — it will be parsed as a new slide.
- Do not use `\n` for line breaks in notes — use a blank line for a new paragraph instead.
  (`\n` only works as a forced break inside a title.)
- Do not put the image syntax inside notes — image layouts only apply when the `![]()` is
  in the title line itself.
- Do not use slide-level class names that start with a digit or contain spaces.
- Do not write `.classname { }` immediately at the start of a `# ` line if you intend it as
  an inline span — it will be parsed as a slide class instead. Put a word before it:
  `# Intro .tag { NEW }` not `# .tag { NEW } Intro`.

---

## Output characteristics

- ~600 KB standalone HTML (fonts are large; Phosphor + Iconoir + OstrichSans ≈ 400 KB base64).
- Zero external dependencies — works offline, from `file://`, on iOS.
- Includes: full keyboard navigation, overview sidebar, speaker notes, presenter window,
  draw/annotation mode, light/dark theme toggle.
- Slide number badge bottom-right of each slide. Suppress with `.no-num` slide class.
