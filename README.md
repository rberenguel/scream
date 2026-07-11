# Scream

A minimal browser-based slide with minimal friction and minimal text.

## Concept

Every `#` header is a slide. Everything else (notes, context, references) lives in the editor but never appears in the presentation. The result is a talk outline that doubles as speaker notes, all in one plain markdown file.

## Layout

Three panes, always visible:

| Pane | Purpose |
|------|---------|
| **Editor** | Full markdown. Write `#` headers for slides; anything beneath is private notes. |
| **Timeline** | One card per `#` header. Drag to reorder — reordering moves the markdown blocks too. Click to jump. |
| **Preview** | Current slide rendered large, with Nord/OstrichSans styling. |

## Slide syntax

```markdown
# Gravity

Curved spacetime. Einstein 1915. Good hook: drop something.

# Light bends

Eddington 1919 eclipse experiment. Connect back to gravity.

# *Everything* is **geometry**

Key insight. Let it land.
```

- `*italic*` → highlighted in Nord yellow
- `**bold**` → highlighted in Nord red-orange
- `:chat:` or `:ph-chat:` → [Phosphor Light](https://phosphoricons.com) icon

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Cmd-S` | Save (shows file picker if no file open yet) |
| `Cmd-O` | Open a `.md` file |
| `O` | Open (when editor not focused) |
| `N` | New blank presentation (when editor not focused) |

## Export

`Cmd-E` (or the Export button) generates a fully standalone `.html` file — fonts inlined, zero external dependencies. Open it in any browser to present.

### Exported presentation controls

| Key | Action |
|-----|--------|
| `← →` / `Space` | Previous / next slide |
| `Home` / `End` | First / last slide |
| `O` | Toggle overview sidebar |
| `N` | Toggle speaker notes panel |
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
| `T` | Text (click to place, type, Enter or Esc to commit) |
| `I` | Interact — click to select/drag shapes, no new drawing |
| `F` | Toggle fill — rect and ellipse get a solid fill blended from the stroke colour and the slide background |
| `C` | Pick colour: `r` red · `o` orange · `y` yellow · `b` blue · `g` green · `w` white |
| `X` | Clear all annotations |
| `Backspace` | Delete selected shape |
| `Esc` | Deselect / exit draw mode |

Annotations clear automatically on slide change.

## File handling

Open a `.md` file via the button, `O`, or `Cmd-O`. Drag-and-drop a `.md` file onto the window also works (read-only; use the button or `Cmd-O` to get write access). Save with `Cmd-S`.

## Running

Serve the folder with any static server, e.g.:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```
