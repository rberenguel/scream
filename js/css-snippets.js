/**
 * Named CSS snippet completions, triggered by `.` in the CSS preamble.
 * Each entry: { name, desc, code }
 *   name  — the partial match trigger (what the user types after '.')
 *   desc  — short description shown in the dropdown
 *   code  — full CSS block to insert (replaces '.' + typed partial)
 *
 * Background classes go on .bg-slice via  ![bg .name]()
 * Text classes go inline as               .name { content }
 */
export const CSS_SNIPPETS = [
    // ── Background layer classes ───────────────────────────────────────────────
    {
        name: 'vignette',
        desc: 'bg: dark edge vignette',
        code: `.vignette::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.65) 100%);
  pointer-events: none;
}`,
    },
    {
        name: 'spotlight',
        desc: 'bg: bright centre, dark edges',
        code: `.spotlight::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 40%, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0.55) 100%);
  pointer-events: none;
}`,
    },
    {
        name: 'warm-grad',
        desc: 'bg: warm dark gradient',
        code: `.warm-grad {
  background: linear-gradient(135deg, #1a0800 0%, #3d1a00 60%, #1a0800 100%);
}`,
    },
    {
        name: 'cool-grad',
        desc: 'bg: cool blue-purple gradient',
        code: `.cool-grad {
  background: linear-gradient(135deg, #020b18 0%, #0d2137 50%, #1a0d2e 100%);
}`,
    },
    {
        name: 'dark-fade',
        desc: 'bg: dark gradient bottom-up (good with images)',
        code: `.dark-fade {
  background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 60%, transparent 100%);
}`,
    },
    // ── Inline text classes ────────────────────────────────────────────────────
    {
        name: 'highlight',
        desc: 'text: yellow highlight mark',
        code: `.highlight {
  background: rgba(255,220,0,0.35);
  border-radius: 2px;
  padding: 0 0.15em;
}`,
    },
    {
        name: 'tag',
        desc: 'text: pill badge',
        code: `.tag {
  background: rgba(255,255,255,0.15);
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 999px;
  padding: 0.05em 0.5em;
  font-size: 0.75em;
  letter-spacing: 0.08em;
}`,
    },
    {
        name: 'box',
        desc: 'text: thin border box',
        code: `.box {
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0.05em 0.35em;
}`,
    },
    {
        name: 'big',
        desc: 'text: 1.4× larger',
        code: `.big { font-size: 1.4em; }`,
    },
    {
        name: 'small',
        desc: 'text: 0.7× smaller',
        code: `.small { font-size: 0.7em; }`,
    },
    {
        name: 'mono',
        desc: 'text: monospace',
        code: `.mono { font-family: monospace; font-size: 0.85em; }`,
    },
    {
        name: 'muted',
        desc: 'text: dimmed / muted',
        code: `.muted { opacity: 0.55; }`,
    },
    {
        name: 'warn',
        desc: 'text: warning orange',
        code: `.warn { color: #e67e00; }`,
    },
    {
        name: 'err',
        desc: 'text: error red',
        code: `.err { color: #c0392b; }`,
    },
    {
        name: 'ok',
        desc: 'text: success green',
        code: `.ok { color: #27ae60; }`,
    },
    {
        name: 'upper',
        desc: 'text: uppercase + spaced',
        code: `.upper { text-transform: uppercase; letter-spacing: 0.1em; }`,
    },
    {
        name: 'underline',
        desc: 'text: underline decoration',
        code: `.underline { text-decoration: underline; text-underline-offset: 0.2em; }`,
    },
];
