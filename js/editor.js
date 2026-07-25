import { CodeJar } from '../libs/codejar.js';
import { cursorPosition } from '../libs/codejar-cursor.js';
import { parseSlides, slideAtLine } from './parser.js';
import { PHOSPHOR_ICONS } from './phosphor-icons.js';
import { ICONOIR_ICONS } from './iconoir-icons.js';
import { CSS_SNIPPETS } from './css-snippets.js';

/** @type {ReturnType<typeof CodeJar>|null} */
let jar = null;

/** @type {HTMLElement|null} */
let editorEl = null;

// ── Syntax highlighting ─────────────────────────────────────────────────────

function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(editor, pos) {
    const text = editor.textContent;

    let activeHeadingLine = -1;
    if (pos != null) {
        const cursorLine = text.slice(0, pos.start).split('\n').length - 1;
        const slides = parseSlides(text);
        const idx = slideAtLine(slides, cursorLine);
        if (idx >= 0) activeHeadingLine = slides[idx].startLine;
    }

    let inFence = false;
    let fenceLang = '';

    editor.innerHTML = text.split('\n').map((line, i) => {
        const esc = escHtml(line);

        if (line.startsWith('```')) {
            inFence = !inFence;
            fenceLang = inFence ? line.slice(3).trim().toLowerCase() : '';
            return `<span class="md-fence">${esc}</span>`;
        }
        if (inFence) {
            return `<span class="${fenceLang === 'css' ? 'md-fence-css' : 'md-fence-body'}">${esc}</span>`;
        }

        if (i === activeHeadingLine) {
            const m = line.match(/^(#+\s?)(.*)/);
            if (m) return `<span class="md-active-slide"><span class="md-h1-marker">${escHtml(m[1])}</span>${escHtml(m[2])}</span>`;
            return `<span class="md-active-slide">${esc}</span>`;
        }
        if (line.startsWith('# ') || line === '#') {
            const m = line.match(/^(#\s?)(.*)/);
            return `<span class="md-h1"><span class="md-h1-marker">${escHtml(m[1])}</span>${escHtml(m[2])}</span>`;
        }
        if (line.startsWith('#')) {
            const m = line.match(/^(#+\s?)(.*)/);
            return `<span class="md-h2"><span class="md-h1-marker">${escHtml(m[1])}</span>${escHtml(m[2])}</span>`;
        }
        if (line.startsWith('> '))                 return `<span class="md-quote">${esc}</span>`;
        if (/^\s*[-*+] /.test(line))               return `<span class="md-list">${esc}</span>`;
        return esc;
    }).join('\n');
}

// ── Text-before-cursor helper ───────────────────────────────────────────────

function _textBeforeCursor() {
    if (!editorEl) return '';
    try {
        const s = editorEl.getRootNode().getSelection();
        if (!s || s.rangeCount === 0) return '';
        const r = document.createRange();
        r.selectNodeContents(editorEl);
        r.setEnd(s.getRangeAt(0).startContainer, s.getRangeAt(0).startOffset);
        return r.toString();
    } catch { return ''; }
}

// ── Autocomplete (icons + CSS snippets) ────────────────────────────────────

let _acDropdown = null;
let _acItems    = [];   // string[] for icons, {name,desc,code}[] for css
let _acIndex    = -1;
let _acMode     = 'icon'; // 'icon' | 'css'
let _acPrefix   = '';     // icon prefix ('ph' | 'in'), unused in css mode
let _acFrom     = 0;

function _getIconMatch(before) {
    const m = before.match(/:(ph|in)-([a-z0-9-]*)$/);
    if (!m) return null;
    const [full, prefix, partial] = m;
    const icons = prefix === 'ph' ? PHOSPHOR_ICONS : ICONOIR_ICONS;
    const matches = icons.filter(n => n.startsWith(partial)).slice(0, 12);
    return matches.length ? { mode: 'icon', prefix, matches, from: before.length - full.length } : null;
}

function _getCssMatch(before) {
    // Only in preamble — no `# ` slide heading has appeared before the cursor yet
    if (/^#\s/m.test(before)) return null;
    const m = before.match(/\.([a-z0-9-]*)$/);
    if (!m) return null;
    const partial = m[1];
    const matches = CSS_SNIPPETS.filter(s => s.name.startsWith(partial));
    return matches.length ? { mode: 'css', matches, from: before.length - m[0].length } : null;
}

function _checkAutocomplete() {
    const before = _textBeforeCursor();
    const match = _getIconMatch(before) ?? _getCssMatch(before);
    if (!match) { _hideAc(); return; }
    _showAc(match);
}

function _showAc({ mode, prefix, matches, from }) {
    if (!_acDropdown) {
        _acDropdown = document.createElement('div');
        _acDropdown.className = 'ac-dropdown';
        document.body.appendChild(_acDropdown);
    }
    const keepIndex = _acVisible() && from === _acFrom && mode === _acMode;
    _acMode   = mode;
    _acItems  = matches;
    _acIndex  = keepIndex ? Math.min(_acIndex, matches.length - 1) : 0;
    _acPrefix = prefix ?? '';
    _acFrom   = from;

    _acDropdown.innerHTML = '';
    matches.forEach((item, i) => {
        const el = document.createElement('div');
        el.className = 'ac-item' + (i === 0 ? ' ac-sel' : '');
        if (mode === 'icon') {
            el.textContent = `:${prefix}-${item}:`;
        } else {
            el.innerHTML =
                `<span class="ac-name">.${item.name}</span>` +
                `<span class="ac-desc">${item.desc}</span>`;
        }
        el.addEventListener('mousedown', e => { e.preventDefault(); _acIndex = i; _applySelected(); });
        _acDropdown.appendChild(el);
    });

    const pos = cursorPosition();
    if (pos) { _acDropdown.style.top = pos.top; _acDropdown.style.left = pos.left; }
    _acDropdown.style.display = 'block';
}

function _hideAc() {
    if (_acDropdown) _acDropdown.style.display = 'none';
    _acItems = []; _acIndex = -1;
}

function _acVisible() {
    return _acDropdown && _acDropdown.style.display !== 'none' && _acItems.length > 0;
}

function _acMoveSel(delta) {
    _acIndex = Math.max(0, Math.min(_acItems.length - 1, _acIndex + delta));
    Array.from(_acDropdown.children).forEach((el, i) =>
        el.classList.toggle('ac-sel', i === _acIndex));
    _acDropdown.children[_acIndex]?.scrollIntoView({ block: 'nearest' });
}

function _applySelected() {
    const item = _acItems[_acIndex];
    if (item == null) return;
    if (_acMode === 'icon') {
        const insertion = `:${_acPrefix}-${item}:`;
        try {
            const curPos = jar.save();
            jar.restore({ start: _acFrom, end: curPos.start, dir: '->' });
            document.execCommand('insertText', false, insertion);
        } catch (e) { console.error('[Scream] icon autocomplete:', e); }
    } else {
        try {
            const curPos = jar.save();
            const text = jar.toString();
            const newText = text.slice(0, _acFrom) + item.code + text.slice(curPos.start);
            jar.updateCode(newText);
            jar.restore({ start: _acFrom + item.code.length, end: _acFrom + item.code.length, dir: '->' });
        } catch (e) { console.error('[Scream] css autocomplete:', e); }
    }
    _hideAc();
    editorEl?.focus();
}

function _handleAcKey(e) {
    if (!_acVisible()) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); _acMoveSel(+1); return true; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); e.stopImmediatePropagation(); _acMoveSel(-1); return true; }
    if (e.key === 'Escape')    { e.preventDefault(); _hideAc();      return true; }
    if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        _applySelected();
        return true;
    }
    return false;
}

// ── Scroll helper ────────────────────────────────────────────────────────────

function _scrollCursorIntoView() {
    setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const container = editorEl?.closest('#editor-container');
        if (!container || !rect.height) return;
        const cRect = container.getBoundingClientRect();
        const margin = 80;
        const relTop = rect.top - cRect.top + container.scrollTop;
        if (rect.top < cRect.top + margin) {
            container.scrollTop = relTop - margin;
        } else if (rect.bottom > cRect.bottom - margin) {
            container.scrollTop = relTop - (cRect.height - margin);
        }
    }, 0);
}

// ── Public API ──────────────────────────────────────────────────────────────

export function setupEditor(container, initialDoc, { onUpdate, onSave, onOpen, onExport, onNewTab, onCloseTab }) {
    editorEl = document.createElement('div');
    editorEl.className = 'codejar-editor';
    container.appendChild(editorEl);

    // Keydown registered BEFORE CodeJar so event.defaultPrevented suppresses its handlers
    editorEl.addEventListener('keydown', e => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod) {
            if (e.key === 's') { e.preventDefault(); onSave?.();     return; }
            if (e.key === 'o') { e.preventDefault(); onOpen?.();     return; }
            if (e.key === 't') { e.preventDefault(); onNewTab?.();   return; }
            if (e.key === 'w') { e.preventDefault(); onCloseTab?.(); return; }
        }
        if (_handleAcKey(e)) return;
        if (e.key === 'Enter') {
            const before = _textBeforeCursor();
            if (before.split('\n').pop().startsWith('# ')) {
                e.preventDefault();
                const pos = jar.save();
                const ins = '\n\n# ';
                const newText = jar.toString().slice(0, pos.start) + ins + jar.toString().slice(pos.end);
                const newPos = pos.start + ins.length;
                jar.updateCode(newText);
                jar.restore({ start: newPos, end: newPos, dir: '->' });
            }
        }
    });

    jar = CodeJar(editorEl, highlight, {
        tab:           '\t',
        preserveIdent: true,
        addClosing:    false,
        catchTab:      true,
        history:       true,
    });

    // CodeJar sets overflow-y:auto on the element; let #editor-container scroll instead
    editorEl.style.overflowY = 'visible';

    // Click anywhere in the editor → navigate to the containing slide
    editorEl.addEventListener('mouseup', () => {
        const text = editorEl.textContent;
        let cursorLine = 0;
        try {
            const s = editorEl.getRootNode().getSelection();
            if (s && s.rangeCount > 0) {
                const r = document.createRange();
                r.selectNodeContents(editorEl);
                r.setEnd(s.getRangeAt(0).startContainer, s.getRangeAt(0).startOffset);
                cursorLine = r.toString().split('\n').length - 1;
            }
        } catch {}
        // Don't navigate when clicking in the preamble (before first slide)
        const slides = parseSlides(text);
        if (slides.length > 0 && cursorLine < slides[0].startLine) return;
        onUpdate(text, cursorLine);
    });

    jar.onUpdate(text => {
        let cursorLine = 0;
        try {
            const s = editorEl.getRootNode().getSelection();
            if (s && s.rangeCount > 0) {
                const r = document.createRange();
                r.selectNodeContents(editorEl);
                r.setEnd(s.getRangeAt(0).startContainer, s.getRangeAt(0).startOffset);
                cursorLine = r.toString().split('\n').length - 1;
            }
        } catch {}
        onUpdate(text, cursorLine);
        _checkAutocomplete();
    });

    jar.updateCode(initialDoc, false);
}

export function getEditorView() { return jar; }

export function setDoc(text) {
    if (!jar) return;
    jar.updateCode(text, false);
}

export function getDoc() {
    return jar?.toString() ?? '';
}

export function placeCursorAtEnd() {
    if (!jar || !editorEl) return;
    const len = editorEl.textContent.length;
    editorEl.focus();
    try { jar.restore({ start: len, end: len, dir: '->' }); } catch {}
}

export function goToLine(lineNum) {
    if (!jar || !editorEl) return;
    const lines = editorEl.textContent.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(lineNum, lines.length); i++) offset += lines[i].length + 1;
    offset = Math.min(offset, editorEl.textContent.length);
    editorEl.focus();
    try { jar.restore({ start: offset, end: offset, dir: '->' }); } catch {}
    _scrollCursorIntoView();
}
