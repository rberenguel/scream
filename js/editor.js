import {
    EditorState, EditorView, keymap,
    defaultKeymap, history, historyKeymap,
    markdown, oneDark, languages, markdownLanguage, GFM,
    StateField, Decoration, RangeSetBuilder,
} from "CodeMirrorBundle";

import { parseSlides, slideAtLine } from './parser.js';

/** @type {EditorView|null} */
let editorView = null;

// ── Active-slide line highlight ────────────────────────────────────────────
// Computes from cursor position on every transaction — no StateEffect needed.

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

// ── Setup ──────────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} container
 * @param {string} initialDoc
 * @param {{ onUpdate: (doc: string, cursorLine: number) => void, onSave: () => void }} callbacks
 */
export function setupEditor(container, initialDoc, { onUpdate, onSave, onOpen, onExport }) {
    const screamKeymap = keymap.of([
        { key: 'Mod-s', run: () => { onSave?.(); return true; } },
        { key: 'Mod-o', run: () => { onOpen?.(); return true; } },
        { key: 'Mod-e', run: () => { onExport?.(); return true; } },
        ...defaultKeymap,
        ...historyKeymap,
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
