import {
    EditorState, EditorView, keymap,
    defaultKeymap, history, historyKeymap,
    markdown, oneDark, languages, markdownLanguage, GFM,
    StateField, Decoration, RangeSetBuilder,
    autocompletion, completionKeymap,
} from "CodeMirrorBundle";

import { parseSlides, slideAtLine } from './parser.js';
import { PHOSPHOR_ICONS } from './phosphor-icons.js';
import { ICONOIR_ICONS } from './iconoir-icons.js';

/** @type {EditorView|null} */
let editorView = null;

// ── Active-slide line highlight ────────────────────────────────────────────

const highlightField = StateField.define({
    create: () => Decoration.none,
    update(deco, tr) {
        if (!tr.docChanged && !tr.selectionSet) return deco;
        const cursorLine = tr.state.doc.lineAt(tr.state.selection.main.head).number - 1;
        const slides = parseSlides(tr.state.doc.toString());
        const idx = slideAtLine(slides, cursorLine);
        if (idx < 0 || idx >= slides.length) return Decoration.none;

        const builder = new RangeSetBuilder();
        try {
            const line = tr.state.doc.line(slides[idx].startLine + 1);
            builder.add(line.from, line.from, Decoration.line({ class: 'cm-active-slide-line' }));
        } catch { /* line out of range */ }
        return builder.finish();
    },
    provide: f => EditorView.decorations.from(f),
});

// ── Icon autocompletion ────────────────────────────────────────────────────
// Triggers after : followed by at least one letter, completes :icon-name:

/** @param {import("CodeMirrorBundle").CompletionContext} ctx */
function iconCompletionSource(ctx) {
    const match = ctx.matchBefore(/:(ph|in)-[a-z0-9-]*/);
    if (!match) return null;
    const m = match.text.match(/^:(ph|in)-(.*)$/);
    if (!m) return null;
    const [, prefix, partial] = m;
    const icons = prefix === 'ph' ? PHOSPHOR_ICONS : ICONOIR_ICONS;
    return {
        from: match.from,
        options: icons
            .filter(n => n.startsWith(partial))
            .map(n => ({ label: `:${prefix}-${n}:`, type: 'keyword', detail: prefix === 'ph' ? 'phosphor' : 'iconoir' })),
        validFor: /^:(ph|in)-[a-z0-9-]*:?$/,
    };
}

// ── Enter: new slide on # lines ────────────────────────────────────────────

function enterOnSlideHeader(view) {
    const state = view.state;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    if (!line.text.startsWith('# ')) return false;
    // Insert blank line + new header, cursor after '# '
    const insert = '\n\n# ';
    view.dispatch({
        changes: { from: line.to, insert },
        selection: { anchor: line.to + insert.length },
        scrollIntoView: true,
    });
    return true;
}

// ── Setup ──────────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} container
 * @param {string} initialDoc
 * @param {{ onUpdate: (doc: string, cursorLine: number) => void, onSave: () => void, onOpen: () => void, onExport: () => void }} callbacks
 */
export function setupEditor(container, initialDoc, { onUpdate, onSave, onOpen, onExport }) {
    const screamKeymap = keymap.of([
        { key: 'Mod-s', run: () => { onSave?.(); return true; } },
        { key: 'Mod-o', run: () => { onOpen?.(); return true; } },
        { key: 'Mod-e', run: () => { onExport?.(); return true; } },
        { key: 'Enter', run: enterOnSlideHeader },
        { key: 'Tab', run: (view) => { view.dispatch(view.state.replaceSelection('\t')); return true; } },
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
    ]);

    const state = EditorState.create({
        doc: initialDoc,
        extensions: [
            history(),
            screamKeymap,
            markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [GFM] }),
            oneDark,
            EditorView.lineWrapping,
            highlightField,
            autocompletion({ override: [iconCompletionSource] }),
            EditorView.updateListener.of((update) => {
                if (!update.docChanged && !update.selectionSet) return;
                const doc = update.state.doc;
                const cursorLine = doc.lineAt(update.state.selection.main.head).number - 1;
                onUpdate(doc.toString(), cursorLine);
            }),
        ],
    });

    editorView = new EditorView({ state, parent: container });
    return editorView;
}

export function getEditorView() { return editorView; }

/** @param {string} text */
export function setDoc(text) {
    if (!editorView) return;
    editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: text },
    });
}

/** Place cursor at end of document and focus. */
export function placeCursorAtEnd() {
    if (!editorView) return;
    const end = editorView.state.doc.length;
    editorView.dispatch({ selection: { anchor: end } });
    editorView.focus();
}

/** @returns {string} */
export function getDoc() {
    return editorView?.state.doc.toString() ?? '';
}

/**
 * Move cursor to a 0-based line number and scroll it into view.
 * @param {number} lineNum
 */
export function goToLine(lineNum) {
    if (!editorView) return;
    try {
        const line = editorView.state.doc.line(lineNum + 1);
        editorView.dispatch({
            selection: { anchor: line.from },
            effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 48 }),
        });
        editorView.focus();
    } catch { /* line out of range */ }
}
