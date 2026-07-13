import { setupEditor, setDoc, getDoc, goToLine, placeCursorAtEnd } from './editor.js';
import { parseSlides, slideAtLine, reorderSlides, parsePreambleCss } from './parser.js';
import { initTimeline, renderTimeline } from './timeline.js';
import { renderPreview } from './preview.js';
import { exportPresentation } from './exporter.js';

// ── Tab state ──────────────────────────────────────────────────────────────

let _nextTabId = 0;
let _suppressDirty = false;

function _makeTab(content = '# ', filename = 'untitled.md', fileHandle = null) {
    return { id: _nextTabId++, filename, fileHandle, dirty: false, content, label: 'untitled' };
}

/** @type {Array<ReturnType<typeof _makeTab>>} */
let tabs = [];
let activeTabId = null;

function getActiveTab() {
    return tabs.find(t => t.id === activeTabId) ?? null;
}

function _isTabPristine(tab) {
    return !tab.dirty && tab.filename === 'untitled.md' && tab.content.trim() === '#';
}

// ── Per-render derived state ───────────────────────────────────────────────

let slides = [];
let activeIndex = -1;

// ── DOM refs ───────────────────────────────────────────────────────────────

let tabBar, timelineList, timelineCount;
let statusFilename, statusSlide, statusSave;

// ── Boot ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    tabBar         = document.getElementById('tab-bar');
    timelineList   = document.getElementById('timeline-list');
    timelineCount  = document.getElementById('timeline-count');
    statusFilename = document.getElementById('status-filename');
    statusSlide    = document.getElementById('status-slide');
    statusSave     = document.getElementById('status-save');

    initTimeline({ onReorder: handleReorder, onSelect: handleTimelineSelect });

    setupEditor(
        document.getElementById('editor-container'),
        '',
        {
            onUpdate:   handleEditorUpdate,
            onSave:     handleSave,
            onOpen:     handleOpen,
            onExport:   handleExport,
            onNewTab:   () => { createTab(); placeCursorAtEnd(); },
            onCloseTab: () => closeTab(activeTabId),
        },
    );

    tabBar.addEventListener('dblclick', (e) => {
        if (e.target === tabBar) { createTab(); placeCursorAtEnd(); }
    });

    document.getElementById('open-btn').addEventListener('click', handleOpen);
    document.getElementById('export-btn').addEventListener('click', handleExport);
    document.getElementById('help-btn').addEventListener('click', () => toggleHelp(true));
    document.getElementById('help-close').addEventListener('click', () => toggleHelp(false));
    document.getElementById('help-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) toggleHelp(false);
    });
    document.addEventListener('keydown', handleGlobalKey);
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', handleDrop);
    window.addEventListener('beforeunload', (e) => {
        if (tabs.some(t => t.dirty)) { e.preventDefault(); e.returnValue = ''; }
    });

    createTab();
    placeCursorAtEnd();
});

// ── Tab management ─────────────────────────────────────────────────────────

function createTab(content = '# ', filename = 'untitled.md', fileHandle = null) {
    if (activeTabId !== null) {
        const cur = getActiveTab();
        if (cur) cur.content = getDoc();
    }
    const tab = _makeTab(content, filename, fileHandle);
    tabs.push(tab);
    _activateTab(tab.id, content);
    return tab;
}

function switchTab(id) {
    if (id === activeTabId) return;
    const cur = getActiveTab();
    if (cur) cur.content = getDoc();
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    _activateTab(tab.id, tab.content);
}

function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) return;

    if (tabs.length === 1) {
        tabs = [];
        activeTabId = null;
        createTab();
        placeCursorAtEnd();
        return;
    }

    const wasActive = id === activeTabId;
    tabs.splice(idx, 1);

    if (wasActive) {
        const next = tabs[Math.min(idx, tabs.length - 1)];
        activeTabId = null;
        _activateTab(next.id, next.content);
    } else {
        renderTabBar();
    }
}

function _activateTab(id, content) {
    activeTabId = id;
    const tab = getActiveTab();

    _suppressDirty = true;
    setDoc(content);
    _suppressDirty = false;

    tab.dirty = false;
    statusFilename.textContent = tab.filename;
    _updateSaveIndicator();
    renderTabBar();
}

// ── Tab bar rendering ──────────────────────────────────────────────────────

function renderTabBar() {
    if (!tabBar) return;
    tabBar.innerHTML = '';
    for (const tab of tabs) {
        const el = document.createElement('div');
        el.className = 'tab-item' +
            (tab.id === activeTabId ? ' active' : '') +
            (tab.dirty ? ' is-dirty' : '');
        el.dataset.tabId = tab.id;

        const labelEl = document.createElement('span');
        labelEl.className = 'tab-title';
        labelEl.textContent = tab.label || 'untitled';

        const dirtyEl = document.createElement('span');
        dirtyEl.className = 'tab-dirty';
        dirtyEl.textContent = '●';

        const closeEl = document.createElement('button');
        closeEl.className = 'tab-close';
        closeEl.textContent = '×';
        closeEl.title = 'Close (⌘W)';
        closeEl.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });

        el.append(labelEl, dirtyEl, closeEl);
        el.addEventListener('click', () => switchTab(tab.id));
        tabBar.appendChild(el);
    }
}

// ── File operations ────────────────────────────────────────────────────────

async function handleOpen() {
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
        });
        const file = await handle.getFile();
        const content = await file.text();

        const cur = getActiveTab();
        if (cur && _isTabPristine(cur)) {
            // Reuse current pristine tab
            cur.fileHandle = handle;
            cur.filename = file.name;
            cur.content = content;
            _activateTab(cur.id, content);
        } else {
            createTab(content, file.name, handle);
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('[Scream] open error:', err);
            alert(`Could not open file: ${err.message}`);
        }
    }
}

async function handleSave() {
    const tab = getActiveTab();
    if (!tab) return;
    const text = getDoc();

    if (!tab.fileHandle) {
        try {
            tab.fileHandle = await window.showSaveFilePicker({
                suggestedName: (tab.label && tab.label !== 'untitled' ? tab.label : 'presentation') + '.md',
                types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
            });
            tab.filename = tab.fileHandle.name;
            statusFilename.textContent = tab.filename;
        } catch (err) {
            if (err.name !== 'AbortError') console.error('[Scream] save-picker error:', err);
            return;
        }
    }

    try {
        const writable = await tab.fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
        tab.dirty = false;
        _updateSaveIndicator();
        _flashSave('Saved');
        renderTabBar();
    } catch (err) {
        console.error('[Scream] save error:', err);
        alert(`Could not save: ${err.message}`);
    }
}

async function handleDrop(e) {
    e.preventDefault();
    const file = [...(e.dataTransfer?.files ?? [])].find(f => f.name.endsWith('.md'));
    if (!file) return;
    const content = await file.text();
    const cur = getActiveTab();
    if (cur && _isTabPristine(cur)) {
        cur.filename = file.name;
        cur.content = content;
        _activateTab(cur.id, content);
    } else {
        createTab(content, file.name, null);
    }
}

async function handleExport() {
    if (!slides.length) { alert('Nothing to export — open or create a presentation first.'); return; }
    const tab = getActiveTab();
    const exportTitle = (tab?.label && tab.label !== 'untitled' ? tab.label : tab?.filename) || 'presentation.md';
    await exportPresentation(slides, exportTitle, { preambleCss: parsePreambleCss(getDoc()) });
}

// ── Editor change handler ──────────────────────────────────────────────────

async function handleEditorUpdate(docText, cursorLine) {
    const tab = getActiveTab();
    if (!tab) return;

    tab.content = docText;

    if (!_suppressDirty && !tab.dirty) {
        tab.dirty = true;
        _updateSaveIndicator();
        // Flip dirty class without full re-render
        const tabEl = tabBar?.querySelector(`.tab-item[data-tab-id="${tab.id}"]`);
        if (tabEl) tabEl.classList.add('is-dirty');
    }

    slides = parseSlides(docText);
    _injectUserCss(docText);
    activeIndex = slides.length > 0 ? slideAtLine(slides, cursorLine) : -1;

    // Live-update the tab label
    const newLabel = slides[0]?.title ?? 'untitled';
    if (tab.label !== newLabel) {
        tab.label = newLabel;
        const labelEl = tabBar?.querySelector(`.tab-item[data-tab-id="${tab.id}"] .tab-title`);
        if (labelEl) labelEl.textContent = newLabel;
    }

    renderTimeline(timelineList, slides, activeIndex);
    timelineCount.textContent = slides.length > 0 ? slides.length : '';

    const slide = slides[activeIndex] ?? null;
    renderPreview(slide?.title ?? null, activeIndex, slides.length);

    statusSlide.textContent = slides.length > 0 ? `${activeIndex + 1} / ${slides.length}` : '';
}

// ── Timeline interactions ──────────────────────────────────────────────────

function handleReorder(fromIndex, toIndex) {
    const doc = getDoc();
    const newDoc = reorderSlides(doc, fromIndex, toIndex);
    if (newDoc === doc) return;

    setDoc(newDoc);
    const tab = getActiveTab();
    if (tab) tab.dirty = true;
    _updateSaveIndicator();

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
    if (inInput) return;

    if (e.metaKey || e.ctrlKey) {
        if (e.key === 't') { e.preventDefault(); createTab(); placeCursorAtEnd(); }
        if (e.key === 'w') { e.preventDefault(); closeTab(activeTabId); }
        return;
    }

    if (e.key === 'o') { e.preventDefault(); handleOpen(); }
    if (e.key === '?') { e.preventDefault(); toggleHelp(); }
    if (e.key === 'Escape') { toggleHelp(false); }
}

// ── Help ───────────────────────────────────────────────────────────────────

let _version = null;

async function toggleHelp(force) {
    const overlay = document.getElementById('help-overlay');
    const show = force !== undefined ? force : overlay.classList.contains('hidden');
    overlay.classList.toggle('hidden', !show);
    if (show && _version === null) {
        try {
            const { version } = await fetch('./manifest.json').then(r => r.json());
            _version = version ?? '';
        } catch { _version = ''; }
        document.getElementById('help-version').textContent = _version ? `v${_version}` : '';
    }
}

// ── User CSS injection ─────────────────────────────────────────────────────

function _injectUserCss(docText) {
    let el = document.getElementById('scream-user-css');
    if (!el) {
        el = document.createElement('style');
        el.id = 'scream-user-css';
        document.head.appendChild(el);
    }
    el.textContent = parsePreambleCss(docText);
}

// ── Save indicator ─────────────────────────────────────────────────────────

function _updateSaveIndicator() {
    const tab = getActiveTab();
    const d = tab?.dirty ?? false;
    statusSave.textContent = d ? '●' : '';
    statusSave.title       = d ? 'Unsaved changes (⌘S to save)' : '';
    statusSave.classList.toggle('visible', d);
}

function _flashSave(msg) {
    statusSave.textContent = msg;
    statusSave.classList.add('visible');
    setTimeout(() => {
        const tab = getActiveTab();
        if (!tab?.dirty) statusSave.classList.remove('visible');
    }, 1500);
}
