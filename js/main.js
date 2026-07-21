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

// ── Draft persistence (localStorage) ─────────────────────────────────────

const DRAFT_KEY = 'scream:draft';

function _saveDraft(tab) {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ content: tab.content, filename: tab.filename }));
    } catch { /* quota exceeded or private browsing */ }
}


function _restoreDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const { content, filename } = JSON.parse(raw);
        if (!content || content.trim() === '#') return;
        const tab = getActiveTab();
        if (!tab || !_isTabPristine(tab)) return;
        tab.filename = filename || 'untitled.md';
        _activateTab(tab.id, content);
    } catch { /* corrupted entry */ }
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

    document.getElementById('editor-container').addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
            const tab = getActiveTab();
            if (tab) _saveDraft(tab);
        }
    });

    tabBar.addEventListener('dblclick', (e) => {
        if (e.target === tabBar) { createTab(); placeCursorAtEnd(); }
    });

    document.getElementById('open-btn').addEventListener('click', handleOpen);
    document.getElementById('export-btn').addEventListener('click', handleExport);
    document.getElementById('help-btn').addEventListener('click', () => toggleHelp(true));
    setupTimelineDrawer();
    setupMenuDrawer();
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
    _restoreDraft();
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
    const suggestedName = (tab.label && tab.label !== 'untitled' ? tab.label : 'presentation') + '.md';

    if (tab.fileHandle) {
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
        return;
    }

    if (window.showSaveFilePicker) {
        try {
            tab.fileHandle = await window.showSaveFilePicker({
                suggestedName,
                types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
            });
            tab.filename = tab.fileHandle.name;
            statusFilename.textContent = tab.filename;
            const writable = await tab.fileHandle.createWritable();
            await writable.write(text);
            await writable.close();
            tab.dirty = false;
            _updateSaveIndicator();
            _flashSave('Saved');
            renderTabBar();
        } catch (err) {
            if (err.name !== 'AbortError') console.error('[Scream] save error:', err);
        }
        return;
    }

    try {
        const blob = new Blob([text], { type: 'text/markdown' });
        const file = new File([blob], suggestedName, { type: 'text/markdown' });
        if (navigator.share && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: suggestedName });
        } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = suggestedName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }
        tab.dirty = false;
        _updateSaveIndicator();
        _flashSave('Saved');
        renderTabBar();
    } catch (err) {
        if (err.name !== 'AbortError') console.error('[Scream] save error:', err);
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

// ── Mobile menu drawer (left edge) ────────────────────────────────────────

function setupMenuDrawer() {
    const menu     = document.getElementById('menu-pane');
    const backdrop = document.getElementById('menu-backdrop');
    const mq       = window.matchMedia('(max-width: 900px)');
    const DRAWER_W       = 220;
    const EDGE_ZONE      = 30;
    const SNAP_THRESHOLD = 60;

    let dragging = false;
    let startX   = 0;
    let isOpen   = false;

    function setOpen(open) {
        isOpen = open;
        document.body.classList.toggle('menu-open', open);
        menu.style.transition = 'transform 0.25s ease';
        menu.style.transform  = open ? 'translateX(0)' : `translateX(-${DRAWER_W}px)`;
    }

    if (mq.matches) menu.style.transform = `translateX(-${DRAWER_W}px)`;
    mq.addEventListener('change', () => {
        if (mq.matches) {
            menu.style.transform = `translateX(-${DRAWER_W}px)`;
        } else {
            menu.style.transition = '';
            menu.style.transform  = '';
            isOpen = false;
            document.body.classList.remove('menu-open');
        }
    });

    document.addEventListener('touchstart', (e) => {
        dragging = false;
        if (!mq.matches) return;
        if (document.body.classList.contains('timeline-open')) return;
        const x = e.touches[0].clientX;
        if (!isOpen && x <= EDGE_ZONE) {
            dragging = true;
            startX   = x;
        } else if (isOpen && !e.target.closest('.menu-action')) {
            dragging = true;
            startX   = x;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!dragging || !mq.matches) return;
        const dx     = e.touches[0].clientX - startX;
        const offset = isOpen
            ? Math.max(-DRAWER_W, Math.min(0, dx))
            : Math.max(-DRAWER_W, Math.min(0, -DRAWER_W + dx));
        menu.style.transition = 'none';
        menu.style.transform  = `translateX(${offset}px)`;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (!dragging || !mq.matches) return;
        dragging     = false;
        const dx     = e.changedTouches[0].clientX - startX;
        const shouldOpen = isOpen ? dx > -SNAP_THRESHOLD : dx > SNAP_THRESHOLD;
        setOpen(shouldOpen);
    }, { passive: true });

    document.addEventListener('touchcancel', () => {
        if (!dragging) return;
        dragging = false;
        menu.style.transition = 'transform 0.25s ease';
        menu.style.transform  = isOpen ? 'translateX(0)' : `translateX(-${DRAWER_W}px)`;
    }, { passive: true });

    backdrop.addEventListener('click', () => setOpen(false));

    function action(id, fn) {
        document.getElementById(id).addEventListener('click', () => { setOpen(false); fn(); });
    }

    action('menu-new',    () => { createTab(); placeCursorAtEnd(); });
    action('menu-open',   handleOpen);
    action('menu-save',   handleSave);
    action('menu-export', handleExport);
    action('menu-help',   () => toggleHelp(true));
}

// ── Mobile timeline drawer ─────────────────────────────────────────────────

function setupTimelineDrawer() {
    const timeline = document.getElementById('timeline-pane');
    const backdrop = document.getElementById('timeline-backdrop');
    const mq       = window.matchMedia('(max-width: 900px)');
    const DRAWER_W       = 200;
    const EDGE_ZONE      = 30;  // px from right edge to start open gesture
    const SNAP_THRESHOLD = 60;  // px of travel needed to snap

    let dragging = false;
    let startX   = 0;
    let isOpen   = false;

    function setOpen(open) {
        isOpen = open;
        document.body.classList.toggle('timeline-open', open);
        timeline.style.transition = 'transform 0.25s ease';
        timeline.style.transform  = open ? 'translateX(0)' : `translateX(${DRAWER_W}px)`;
    }

    function onMqChange() {
        if (!mq.matches) {
            // Leaving mobile: clear all inline overrides
            timeline.style.transition = '';
            timeline.style.transform  = '';
            isOpen = false;
            document.body.classList.remove('timeline-open');
        } else {
            // Entering mobile: sync inline style to closed state
            timeline.style.transform = `translateX(${DRAWER_W}px)`;
        }
    }

    mq.addEventListener('change', onMqChange);
    if (mq.matches) timeline.style.transform = `translateX(${DRAWER_W}px)`;

    document.addEventListener('touchstart', (e) => {
        dragging = false; // always reset — guards against touchcancel leaving it stuck
        if (!mq.matches) return;
        if (document.body.classList.contains('menu-open')) return;
        const x = e.touches[0].clientX;
        if (!isOpen && x >= window.innerWidth - EDGE_ZONE) {
            dragging = true;
            startX   = x;
        } else if (isOpen && !e.target.closest('.timeline-card')) {
            dragging = true;
            startX   = x;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!dragging || !mq.matches) return;
        const dx     = e.touches[0].clientX - startX;
        const offset = isOpen
            ? Math.max(0, Math.min(DRAWER_W, dx))
            : Math.max(0, Math.min(DRAWER_W, DRAWER_W + dx));
        timeline.style.transition = 'none';
        timeline.style.transform  = `translateX(${offset}px)`;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (!dragging || !mq.matches) return;
        dragging     = false;
        const dx     = e.changedTouches[0].clientX - startX;
        const shouldOpen = isOpen ? dx < SNAP_THRESHOLD : dx < -SNAP_THRESHOLD;
        setOpen(shouldOpen);
    }, { passive: true });

    document.addEventListener('touchcancel', () => {
        if (!dragging) return;
        dragging = false;
        // Snap back to whichever state we were in before the gesture
        timeline.style.transition = 'transform 0.25s ease';
        timeline.style.transform  = isOpen ? 'translateX(0)' : `translateX(${DRAWER_W}px)`;
    }, { passive: true });

    backdrop.addEventListener('click', () => setOpen(false));
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
