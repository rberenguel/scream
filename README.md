# Scream

A minimal browser-based slide editor. One idea per slide, maximum friction reduction for teaching prep.

## Concept

Every `#` header is a slide. Everything else (notes, context, references) lives in the editor but never appears in the presentation. The result is a talk outline that doubles as speaker notes, all in one plain markdown file.

## Layout

Three panes, always visible:

| Pane | Purpose |
|------|---------|
| **Editor** | Full markdown. Write `#` headers for slides; anything beneath is private notes. |
| **Timeline** | One card per `#` header. Drag to reorder — reordering moves the markdown blocks too. Click to jump. |
| **Preview** | Current slide rendered large, with Nord/OstrichSans styling. |

The app opens directly into a blank slide. Press `?` or click the `?` button (top-right) for the built-in shortcut reference.

## Slide syntax

```markdown
# Gravity

Curved spacetime. Einstein 1915. Good hook: drop something.

# Light bends

Eddington 1919 eclipse experiment. Connect back to gravity.

# *Everything* is **geometry**

Key insight. Let it land.
```

- `*italic*` → Nord yellow
- `**bold**` → Nord red-orange
- `:ph-name:` → [Phosphor Light](https://phosphoricons.com) icon
- `:in-name:` → [Iconoir](https://iconoir.com) icon

Type `:ph-` or `:in-` in the editor for autocomplete.

Pressing `Enter` on a `# ` line inserts a blank line followed by a new `# `, ready for the next slide. The blank line is available for notes.

## Image layouts

Place an image with a special alt-text keyword anywhere in a slide title to trigger a layout:

| Syntax | Effect |
|--------|--------|
| `![bg](url)` | Full-bleed background, image dimmed and blurred, text on top |
| `![bg brightness(60%) blur(2px)](url)` | Background with custom filter |
| `![left](url) text` | 50/50 split — image left, text right |
| `![right](url) text` | 50/50 split — image right, text left |
| `![anything](url)` (lone image, no text) | Simple fill, no overlay |

Multiple `![bg](url)` images on the same slide produce a vertically sliced background.

A `backgrounds/` folder at the project root is a convenient place to store local images; reference them as `![bg](backgrounds/myfile.jpg)`.

## Styling

### CSS preamble

Place a fenced CSS block before the first slide to define custom classes:

````markdown
```css
.red   { color: #bf3030 }
.large { font-size: 14cqi }
```

# First slide
````

The block is live in the editor and inlined into exports.

### Inline spans

Wrap part of a slide title in a class with `.classname { content }`:

```markdown
# Hello .red { world }
# .large { BIG } and normal
```

Renders as `Hello <span class="red">world</span>` etc. Markdown and icons work inside the braces too.

## Editor shortcuts

| Key | Action |
|-----|--------|
| `Cmd-S` | Save (shows file picker on first save) |
| `Cmd-O` / `O` | Open a `.md` file |
| `Cmd-E` | Export as standalone HTML |
| `Tab` | Insert tab character |
| `?` | Toggle help overlay |

## Export

`Cmd-E` (or the Export button) generates a fully standalone `.html` file — all fonts base64-inlined, zero external dependencies. Open it in any browser to present.

### Presentation controls

| Key | Action |
|-----|--------|
| `← →` / `Space` | Previous / next slide |
| `Home` / `End` | First / last slide |
| `O` | Toggle overview sidebar |
| `N` | Toggle speaker notes panel |
| `L` | Toggle light / dark theme |
| `P` | Open presenter window (synced via BroadcastChannel) |
| `B` | Blackout screen |
| `D` | Enter / exit draw mode |

### Draw mode tools

| Key | Tool |
|-----|------|
| `A` | Arrow |
| `R` | Rectangle |
| `E` | Ellipse |
| `H` | Highlight (semi-transparent fill) |
| `T` | Text (click to place, Enter or Esc to commit) |
| `I` | Interact — select/drag existing shapes |
| `F` | Toggle fill (rect/ellipse get a solid fill) |
| `C` | Pick colour: `r` red · `o` orange · `y` yellow · `b` blue · `g` green · `w` white |
| `X` | Clear all annotations |
| `Backspace` | Delete selected shape |
| `Esc` | Deselect / exit draw mode |

Annotations clear automatically on slide change.

## File handling

Open via the **Open** button, `O`, or `Cmd-O`. Drag-and-drop a `.md` file onto the window also works (read-only; use Open or `Cmd-O` to get write access). Save with `Cmd-S`.

## Running

Serve the folder with any static server, e.g.:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Inspiration

Scream is a standalone spinoff of ideas from [obsidian-preso-plugin](https://github.com/rberenguel/obsidian-preso-plugin), a presentation plugin for Obsidian that is itself inspired by [Deckset](https://www.deckset.com/). The image layout syntax (`bg`, `left`, `right` alt-text keywords) and the split/background CSS are adapted directly from it.
