/**
 * main.js — wires editor, timeline, and preview together.
 */

import { setupEditor, setDoc, getDoc, goToLine } from './editor.js';
import { parseSlides, slideAtLine, reorderSlides } from './parser.js';
import { initTimeline, renderTimeline } from './timeline.js';
import { renderPreview } from './preview.js';
import { exportPresentation } from './exporter.js';

// ── State ──────────────────────────────────────────────────────────────────

/** @type {import('./parser.js').Slide[]} */
let slides = [];
let activeIndex = -1;
let dirty = false;

/** @type {FileSystemFileHandle|null} */
let fileHandle = null;
let filename = '';

// ── DOM refs ───────────────────────────────────────────────────────────────

let loadingOverlay, app, timelineList, timelineCount;
let statusFilename, statusSlide, statusSave;

// ── Boot ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    loadingOverlay = document.getElementById('loading-overlay');
    app            = document.getElementById('app');
    timelineList   = document.getElementById('timeline-list');
    timelineCount  = document.getElementById('timeline-count');
    statusFilename = document.getElementById('status-filename');
    statusSlide    = document.getElementById('status-slide');
    statusSave     = document.getElementById('status-save');

    initTimeline({
        onReorder: handleReorder,
        onSelect:  handleTimelineSelect,
    });

    setupEditor(
        document.getElementById('editor-container'),
        '',
        { onUpdate: handleEditorUpdate, onSave: handleSave, onOpen: handleOpen, onExport: handleExport },
    );

    document.getElementById('open-btn').addEventListener('click', handleOpen);
    document.getElementById('new-btn').addEventListener('click', handleNew);
    document.getElementById('export-btn').addEventListener('click', handleExport);
    document.addEventListener('keydown', handleGlobalKey);

    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', handleDrop);

    window.addEventListener('beforeunload', (e) => {
        if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
});

// ── File operations ────────────────────────────────────────────────────────

async function handleOpen() {
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
        });
        fileHandle = handle;
        const file = await handle.getFile();
        filename = file.name;
        const content = await file.text();
        await loadContent(content, filename);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('[Scream] open error:', err);
            alert(`Could not open file: ${err.message}`);
        }
    }
}

function handleNew() {
    fileHandle = null;
    filename = 'untitled.md';
    const starter = '# ';
    loadContent(starter, filename);
}

async function handleSave() {
    const text = getDoc();

    if (!fileHandle) {
        // Offer a save picker
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: filename || 'presentation.md',
                types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
            });
            filename = fileHandle.name;
            statusFilename.textContent = filename;
        } catch (err) {
            if (err.name !== 'AbortError') console.error('[Scream] save-picker error:', err);
            return;
        }
    }

    try {
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
        _markClean();
        _flashSave('Saved');
    } catch (err) {
        console.error('[Scream] save error:', err);
        alert(`Could not save: ${err.message}`);
    }
}

async function handleDrop(e) {
    e.preventDefault();
    const file = [...(e.dataTransfer?.files ?? [])].find(f => f.name.endsWith('.md'));
    if (!file) return;
    fileHandle = null; // no write access from drop
    filename = file.name;
    const content = await file.text();
    await loadContent(content, filename);
}

async function handleExport() {
    if (!slides.length) { alert('Nothing to export — open or create a presentation first.'); return; }
    await exportPresentation(slides, filename || 'presentation.md');
}

// ── Load ───────────────────────────────────────────────────────────────────

async function loadContent(content, name) {
    filename = name;
    setDoc(content);

    loadingOverlay.classList.add('hidden');
    app.classList.remove('hidden');

    statusFilename.textContent = name;
    dirty = false;
    _updateSaveIndicator();

    // Initial render at line 0
    await handleEditorUpdate(content, 0);
}

// ── Editor change handler ──────────────────────────────────────────────────

async function handleEditorUpdate(docText, cursorLine) {
    if (!app || app.classList.contains('hidden')) return;

    // Mark dirty on any edit after initial load
    if (docText !== getDoc() || dirty) _markDirty();

    slides = parseSlides(docText);
    const idx = slides.length > 0 ? slideAtLine(slides, cursorLine) : -1;

    activeIndex = idx;

    // Update timeline
    renderTimeline(timelineList, slides, activeIndex);
    timelineCount.textContent = slides.length > 0 ? slides.length : '';

    // Update preview
    const slide = slides[activeIndex] ?? null;
    renderPreview(slide?.title ?? null, activeIndex, slides.length);

    // Update status bar
    statusSlide.textContent = slides.length > 0
        ? `${activeIndex + 1} / ${slides.length}`
        : '';
}

// ── Timeline interactions ──────────────────────────────────────────────────

function handleReorder(fromIndex, toIndex) {
    const doc = getDoc();
    const newDoc = reorderSlides(doc, fromIndex, toIndex);
    if (newDoc === doc) return;

    setDoc(newDoc);
    _markDirty();

    // After reorder, keep the moved slide active
    // Parse again to find the new position of the moved slide
    const newSlides = parseSlides(newDoc);
    const targetSlide = newSlides[toIndex];

    slides = newSlides;
    activeIndex = toIndex;

    renderTimeline(timelineList, slides, activeIndex);
    timelineCount.textContent = slides.length;

    renderPreview(targetSlide?.title ?? null, activeIndex, slides.length);
    if (targetSlide) goToLine(targetSlide.startLine);

    statusSlide.textContent = `${activeIndex + 1} / ${slides.length}`;
}

function handleTimelineSelect(index) {
    if (index < 0 || index >= slides.length) return;

    activeIndex = index;
    const slide = slides[index];

    renderTimeline(timelineList, slides, activeIndex);
    renderPreview(slide.title, activeIndex, slides.length);
    goToLine(slide.startLine);

    statusSlide.textContent = `${activeIndex + 1} / ${slides.length}`;
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────

function handleGlobalKey(e) {
    const inInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;
    if (inInput || e.metaKey || e.ctrlKey) return;

    if (e.key === 'o') { e.preventDefault(); handleOpen(); }
    if (e.key === 'n') { e.preventDefault(); handleNew(); }
}

// ── Dirty / save indicator ─────────────────────────────────────────────────

function _markDirty() {
    if (dirty) return;
    dirty = true;
    _updateSaveIndicator();
}

function _markClean() {
    dirty = false;
    _updateSaveIndicator();
}

function _updateSaveIndicator() {
    statusSave.textContent = dirty ? '●' : '';
    statusSave.title       = dirty ? 'Unsaved changes (Cmd-S to save)' : '';
    statusSave.classList.toggle('visible', dirty);
}

function _flashSave(msg) {
    statusSave.textContent = msg;
    statusSave.classList.add('visible');
    setTimeout(() => {
        if (!dirty) statusSave.classList.remove('visible');
    }, 1500);
}
