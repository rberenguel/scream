/**
 * exporter.js — generates a standalone HTML presentation from the current slides.
 *
 * All fonts are base64-inlined; notes are pre-rendered; the output file has
 * zero external dependencies.
 *
 * Exported file controls:
 *   ← → / Space — prev / next slide
 *   N           — toggle speaker notes panel
 *   P           — open presenter window (BroadcastChannel sync)
 *   Home / End  — first / last slide
 */

async function fetchAsBase64(url, mimeType) {
    const resp = await fetch(url);
    const blob = new Blob([await resp.arrayBuffer()], { type: mimeType });
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function expandInlineStyles(html) {
    return html.replace(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)\s*\{([^}]*)\}/g, (_, cls, body) =>
        `<span class="${cls}">${body}</span>`
    );
}

function expandIcons(html) {
    return html.replace(/:([a-z][a-z0-9-]+):/g, (_, name) => {
        if (name.startsWith('in-')) {
            const cls = `iconoirfont-${name.slice(3)}`;
            return `<i class="${cls}" aria-hidden="true"></i>`;
        }
        const cls = name.startsWith('ph-') ? name : `ph-${name}`;
        return `<i class="ph-light ${cls}" aria-hidden="true"></i>`;
    });
}

function slideContentFontSize(textLen) {
    if (textLen > 60) return '5cqi';
    if (textLen > 35) return '7cqi';
    if (textLen > 20) return '9cqi';
    return null;
}

function buildSlideContentEl(titleHtml) {
    const shadow = document.createElement('div');
    shadow.innerHTML = titleHtml;

    const el = document.createElement('div');
    el.className = 'slide-content';

    const allImages = Array.from(shadow.querySelectorAll('img'));

    if (allImages.length === 1 &&
        !allImages[0].alt.match(/^(bg|left|right)/) &&
        shadow.textContent.trim() === '') {
        el.classList.add('layout-fill');
        el.style.backgroundImage = `url("${allImages[0].src}")`;
        return el;
    }

    const imageInfos = allImages.map(img => ({
        el: img,
        match: img.alt.match(/^(bg|left|right)(?:\s+(.*))?$/),
    }));
    const bgInfos  = imageInfos.filter(i => i.match && i.match[1] === 'bg');
    const sideInfo = imageInfos.find(i => i.match && (i.match[1] === 'left' || i.match[1] === 'right'));

    if (bgInfos.length > 0) {
        el.classList.add('layout-bg');

        const sliceContainer = document.createElement('div');
        sliceContainer.className = 'bg-slice-container';
        bgInfos.forEach(info => {
            const slice = document.createElement('div');
            slice.className = 'bg-slice';
            slice.style.backgroundImage = `url("${info.el.src}")`;
            sliceContainer.appendChild(slice);
            (info.el.closest('p') || info.el).remove();
        });
        shadow.querySelectorAll('p').forEach(p => { if (!p.textContent.trim()) p.remove(); });

        const wrapper = document.createElement('div');
        wrapper.className = 'bg-content-wrapper';
        const filter = bgInfos[0].match[2]?.trim();
        if (filter) wrapper.style.setProperty('--custom-bg-filter', filter);
        wrapper.append(...shadow.childNodes);
        el.append(sliceContainer, wrapper);

    } else if (sideInfo) {
        const side = sideInfo.match[1];
        const src  = sideInfo.el.src;
        (sideInfo.el.closest('p') || sideInfo.el).remove();
        shadow.querySelectorAll('p').forEach(p => { if (!p.innerHTML.trim()) p.remove(); });

        el.classList.add('layout-split', side === 'left' ? 'split-left' : 'split-right');
        const imgPane = document.createElement('div');
        imgPane.className = 'split-image-pane';
        imgPane.style.backgroundImage = `url("${src}")`;
        const txtPane = document.createElement('div');
        txtPane.className = 'split-text-pane';
        txtPane.append(...shadow.childNodes);
        el.append(imgPane, txtPane);

    } else {
        const fontSize = slideContentFontSize(shadow.textContent.length);
        if (fontSize) el.style.fontSize = fontSize;
        el.append(...shadow.childNodes);
    }

    return el;
}

function buildSlideEl(slide, index, total) {
    const titleHtml = expandInlineStyles(expandIcons(marked.parseInline(slide.title || '')));
    const contentEl = buildSlideContentEl(titleHtml);
    return `<div class="slide-wrapper${index === 0 ? ' active' : ''}" data-index="${index}">
  <div class="slide-preview-box">
    ${contentEl.outerHTML}
    <div class="slide-badge">${index + 1}&thinsp;/&thinsp;${total}</div>
  </div>
</div>`;
}

function buildNotesEl(slide, index) {
    const html = slide.notes ? marked.parse(slide.notes) : '';
    return `<div class="notes-slide${index === 0 ? ' active' : ''}" data-index="${index}">${html}</div>`;
}

function buildOverviewEl(slides) {
    return slides.map((s, i) => {
        const title = s.title || '—';
        return `<div class="ov-card${i === 0 ? ' active' : ''}" data-index="${i}">
  <span class="ov-num">${i + 1}</span>
  <span class="ov-title">${escapeHtml(title)}</span>
</div>`;
    }).join('\n');
}

const EXPORT_CSS = `
*, *::before, *::after { box-sizing: border-box; }

:root {
  --slide-bg:         #1a1a1a;
  --slide-text:       #bf616a;
  --bg:               #111;
  --text:             #d4d4d4;
  --border:           #434c5e;
  --muted:            #555;
  --accent:           #5b7fde;
  --strong:           #ff7043;
  --em:               #ebcb8b;
  --code-color:       #b5cea8;
  --code-bg:          rgba(255,255,255,0.06);
  --panel-bg:         #181818;
  --sidebar-bg:       #141414;
  --sidebar-border:   #2c2c2c;
  --card-hover:       #1e1e1e;
  --card-active:      #1e2a45;
  --card-active-text: #fff;
  --badge:            #333;
  --nav-hint:         #2a2a2a;
  --pv-bg:            #0d0d0d;
  --btn-bg:           #222;
  --btn-border:       #333;
  --btn-hover:        #2c2c2c;
  --slide-shadow:     rgba(0,0,0,0.6);
  --link:             #88c0d0;

  /* Solarized palette — for use in CSS preamble and inline styles */
  --base03:  #002b36;
  --base02:  #073642;
  --base01:  #586e75;
  --base00:  #657b83;
  --base0:   #839496;
  --base1:   #93a1a1;
  --base2:   #eee8d5;
  --base3:   #fdf6e3;
  --yellow:  #b58900;
  --orange:  #cb4b16;
  --red:     #dc322f;
  --magenta: #d33682;
  --violet:  #6c71c4;
  --blue:    #268bd2;
  --cyan:    #2aa198;
  --green:   #859900;
}

body.light-theme {
  --slide-bg:         #fafafa;
  --bg:               #e4e4e4;
  --text:             #1c1c1c;
  --border:           #c0c0c0;
  --muted:            #888;
  --strong:           #c0392b;
  --em:               #a07800;
  --code-color:       #2e7d32;
  --code-bg:          rgba(0,0,0,0.07);
  --panel-bg:         #ececec;
  --sidebar-bg:       #e0e0e0;
  --sidebar-border:   #d0d0d0;
  --card-hover:       #d8d8d8;
  --card-active:      #ccd8f5;
  --card-active-text: #1c1c1c;
  --badge:            #bbb;
  --nav-hint:         #bbb;
  --pv-bg:            #d8d8d8;
  --btn-bg:           #d0d0d0;
  --btn-border:       #c0c0c0;
  --btn-hover:        #c8c8c8;
  --slide-shadow:     rgba(0,0,0,0.18);
  --link:             #3b6fa0;
}

html, body {
  margin: 0;
  height: 100vh;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* ── Audience view ── */

#main-view {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: row;
}

/* Overview sidebar */

.overview-pane {
  width: 0;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
  overflow-y: auto;
  transition: width 0.2s ease;
  scrollbar-width: thin;
  scrollbar-color: var(--sidebar-border) transparent;
}

body.overview-open .overview-pane { width: 170px; }

.ov-card {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.5rem 0.65rem;
  cursor: pointer;
  border-bottom: 1px solid var(--sidebar-border);
  transition: background 0.1s;
  user-select: none;
}

.ov-card:hover  { background: var(--card-hover); }
.ov-card.active { background: var(--card-active); }

.ov-num {
  font-size: 0.55rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  min-width: 1.4em;
  flex-shrink: 0;
  padding-top: 0.1em;
}

.ov-card.active .ov-num { color: var(--accent); }

.ov-title {
  font-family: 'OstrichSans', sans-serif;
  font-weight: 900;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  line-height: 1.25;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.ov-card:hover  .ov-title { color: var(--text); }
.ov-card.active .ov-title { color: var(--card-active-text); }

/* Column wrapper for slides + notes */

.main-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

#slides-container {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.slide-wrapper {
  display: none;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
}

.slide-wrapper.active { display: flex; }

.slide-preview-box {
  width: 100%;
  max-height: 100%;
  aspect-ratio: 16 / 9;
  background: var(--slide-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 30px var(--slide-shadow);
  container-type: inline-size;
  overflow: hidden;
  position: relative;
}

.slide-content {
  padding: 8% 10%;
  text-align: center;
  width: 100%;
  background: var(--slide-bg);
  color: var(--slide-text);
  font-family: 'OstrichSans', sans-serif;
  font-size: 11cqi;
  font-weight: 900;
  line-height: 1.1;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  word-break: break-word;
  hyphens: auto;
  -webkit-font-smoothing: antialiased;
}

.slide-content strong { color: var(--strong); font-weight: 900; }
.slide-content em     { color: var(--em); font-style: italic; }
.slide-content code {
  font-family: monospace;
  font-size: 0.8em;
  color: var(--code-color);
  background: var(--code-bg);
  padding: 0.05em 0.25em;
  border-radius: 3px;
}

.slide-content .ph-light,
.slide-content [class^="iconoirfont-"],
.slide-content [class*=" iconoirfont-"] {
  font-size: 1.1em;
  vertical-align: middle;
  line-height: 1;
  display: inline-block;
  text-transform: none !important;
  letter-spacing: 0;
}

.slide-badge {
  position: absolute;
  bottom: 3%;
  right: 3%;
  font-size: 1.5cqi;
  color: var(--badge);
  font-variant-numeric: tabular-nums;
  user-select: none;
  pointer-events: none;
}

/* Image layout modes */

.slide-content.layout-fill,
.slide-content.layout-bg,
.slide-content.layout-split {
  height: 100%;
  padding: 0;
}
.slide-content.layout-fill {
  background-size: cover;
  background-position: center;
}
.slide-content.layout-bg {
  background-size: cover;
  background-position: center;
  position: relative;
}
.bg-slice-container {
  display: flex;
  position: absolute;
  inset: 0;
  z-index: 0;
}
.bg-slice {
  flex: 1;
  height: 100%;
  background-size: cover;
  background-position: center;
  filter: var(--custom-bg-filter, brightness(80%) blur(4px));
  transform: scale(1.05);
}
.bg-content-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 4cqi;
  box-sizing: border-box;
}
.bg-content-wrapper::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  background-color: rgba(0, 0, 0, 0.3);
}
body.light-theme .bg-content-wrapper::before {
  background-color: rgba(255, 255, 255, 0.1);
}
.bg-content-wrapper > * {
  position: relative;
  z-index: 2;
}
.slide-content.layout-bg :is(h1, h2, h3, h4, h5, h6) {
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9);
}
body.light-theme .slide-content.layout-bg :is(h1, h2, h3, h4, h5, h6) {
  text-shadow: 0 0 6px rgba(255,255,255,0.7), 0 0 1px rgba(255,255,255,0.5);
}
.slide-content.layout-split {
  display: flex;
  flex-direction: row;
}
.slide-content.layout-split.split-right {
  flex-direction: row-reverse;
}
.split-image-pane {
  flex: 0 0 50%;
  height: 100%;
  background-size: cover;
  background-position: center;
}
.split-text-pane {
  flex: 0 0 50%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 4cqi;
  box-sizing: border-box;
}

/* Notes panel (audience view) */

#notes-panel {
  flex: 0 0 0;
  overflow-y: hidden;
  background: var(--panel-bg);
  border-top: 1px solid var(--sidebar-border);
  transition: flex-basis 0.25s ease;
}

body.notes-open #notes-panel {
  flex-basis: 35%;
  overflow-y: auto;
  padding: 1rem 2rem;
}

.notes-slide        { display: none; }
.notes-slide.active { display: block; }

#notes-panel, .pv-notes {
  font-size: 1.15rem;
  line-height: 1.65;
}

#notes-panel p, .pv-notes p   { margin: 0.5em 0; }
#notes-panel ul, .pv-notes ul,
#notes-panel ol, .pv-notes ol { padding-left: 1.5em; margin: 0.4em 0; }
#notes-panel li, .pv-notes li { margin: 0.2em 0; }

#notes-panel h1, #notes-panel h2, #notes-panel h3,
.pv-notes h1,   .pv-notes h2,   .pv-notes h3 {
  margin: 0.75em 0 0.25em;
  font-size: 1em;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.03em;
}

#notes-panel strong, .pv-notes strong {
  color: var(--strong);
  font-weight: 700;
}

#notes-panel em, .pv-notes em {
  color: var(--em);
  font-style: italic;
}

#notes-panel a, .pv-notes a {
  color: var(--link);
  text-decoration: underline;
  text-underline-offset: 2px;
}

#notes-panel a:hover, .pv-notes a:hover {
  opacity: 0.8;
}

#notes-panel code, .pv-notes code {
  font-family: monospace;
  font-size: 0.85em;
  color: var(--code-color);
  background: var(--code-bg);
  padding: 0.1em 0.3em;
  border-radius: 3px;
}

/* Keyboard hint */

#nav-hint {
  position: fixed;
  bottom: 6px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--nav-hint);
  user-select: none;
  pointer-events: none;
  white-space: nowrap;
}

/* ── Annotation overlay ── */

#anno-svg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 100;
  overflow: visible;
}

body.draw-mode #anno-svg {
  pointer-events: all;
  cursor: crosshair;
}

#blackout {
  display: none;
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 90;
}

body.blackout-on #blackout { display: block; }

#draw-indicator {
  position: fixed;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: transparent;
  user-select: none;
  pointer-events: none;
  z-index: 200;
  white-space: nowrap;
  transition: color 0.2s;
}

body.draw-mode #draw-indicator { color: #bf616a; }

/* ── Presenter view ── */

#presenter-view {
  position: fixed;
  inset: 0;
  display: none;
  flex-direction: row;
  background: var(--pv-bg);
}

/* pv-main: left column — large current slide + notes */

.pv-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
  gap: 0.6rem;
  overflow: hidden;
}

.pv-current {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pv-current .slide-preview-box {
  width: 100%;
  max-height: 100%;
}

.pv-notes {
  flex: 0 0 28%;
  min-height: 0;
  overflow-y: auto;
  background: var(--panel-bg);
  border: 1px solid var(--sidebar-border);
  border-radius: 4px;
  padding: 0.6rem 1rem;
  font-size: 1.3rem;
  line-height: 1.5;
}

.pv-notes-empty {
  color: var(--muted);
  font-size: 0.8rem;
  font-style: italic;
}

/* pv-sidebar: right column — controls + next slide */

.pv-sidebar {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--sidebar-bg);
  border-left: 1px solid var(--sidebar-border);
  padding: 0.75rem;
  gap: 0.75rem;
  overflow: hidden;
}

.pv-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.pv-controls button {
  flex: 1;
  padding: 0.45rem 0.5rem;
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--text);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.pv-controls button:hover { background: var(--btn-hover); }

#pv-counter {
  flex: 0 0 auto;
  font-size: 0.8rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: center;
  min-width: 3.5em;
}

.pv-next-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.pv-label {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--muted);
  flex-shrink: 0;
}

.pv-slide-host {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pv-slide-host .slide-preview-box {
  width: 100%;
  max-height: 100%;
  box-shadow: 0 2px 12px var(--slide-shadow);
}
`;

const NAVIGATION_JS = `(function () {
  var CHANNEL = 'scream-presenter';
  var isPresenter = window.name === CHANNEL;
  var channel = new BroadcastChannel(CHANNEL);
  var presenterWin = null;

  var current = 0;
  var wrappers   = Array.from(document.querySelectorAll('.slide-wrapper'));
  var noteSlides = Array.from(document.querySelectorAll('.notes-slide'));
  var ovCards    = Array.from(document.querySelectorAll('.ov-card'));
  var total = wrappers.length;

  /* ── shared ── */

  function broadcastState() {
    if (isPresenter || !presenterWin || presenterWin.closed) return;
    var prev = (current - 1 + total) % total;
    var next = (current + 1) % total;
    channel.postMessage({
      type: 'state-update',
      idx: current,
      total: total,
      cur:   wrappers[current].querySelector('.slide-preview-box').outerHTML,
      nxt:   wrappers[next].querySelector('.slide-preview-box').outerHTML,
      notes: noteSlides[current].innerHTML,
      light: document.body.classList.contains('light-theme'),
    });
  }

  function showSlide(i) {
    wrappers[current].classList.remove('active');
    noteSlides[current].classList.remove('active');
    if (ovCards[current]) ovCards[current].classList.remove('active');
    current = ((i % total) + total) % total;
    wrappers[current].classList.add('active');
    noteSlides[current].classList.add('active');
    if (ovCards[current]) {
      ovCards[current].classList.add('active');
      ovCards[current].scrollIntoView({ block: 'nearest' });
    }
    document.dispatchEvent(new CustomEvent('scream:slidechange'));
    if (!isPresenter) broadcastState();
  }

  /* ── presenter window ── */

  if (isPresenter) {
    document.getElementById('main-view').style.display = 'none';
    var pv = document.getElementById('presenter-view');
    pv.style.display = 'flex';

    var elCur    = document.getElementById('pv-current-slide');
    var elNxt    = document.getElementById('pv-next-slide');
    var elNotes  = document.getElementById('pv-notes');
    var elCount  = document.getElementById('pv-counter');

    document.getElementById('pv-prev-btn').onclick = function () {
      channel.postMessage({ type: 'cmd', action: 'prev' });
    };
    document.getElementById('pv-next-btn').onclick = function () {
      channel.postMessage({ type: 'cmd', action: 'next' });
    };

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        channel.postMessage({ type: 'cmd', action: 'next' });
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        channel.postMessage({ type: 'cmd', action: 'prev' });
      }
    });

    channel.onmessage = function (e) {
      var m = e.data;
      if (m.type !== 'state-update') return;
      elCur.innerHTML   = m.cur;
      elNxt.innerHTML   = m.nxt;
      elNotes.innerHTML = m.notes || '<span class="pv-notes-empty">No notes</span>';
      if (elCount) elCount.textContent = (m.idx + 1) + ' / ' + m.total;
      document.body.classList.toggle('light-theme', !!m.light);
    };

    window.addEventListener('beforeunload', function () {
      channel.postMessage({ type: 'cmd', action: 'presenter-closing' });
    });

    setTimeout(function () {
      channel.postMessage({ type: 'cmd', action: 'presenter-ready' });
    }, 150);

  /* ── audience window ── */

  } else {
    channel.onmessage = function (e) {
      var m = e.data;
      if (m.type !== 'cmd') return;
      if      (m.action === 'next')              showSlide(current + 1);
      else if (m.action === 'prev')              showSlide(current - 1);
      else if (m.action === 'presenter-closing') presenterWin = null;
      else if (m.action === 'presenter-ready') {
        presenterWin = window.open('', CHANNEL);
        broadcastState();
      }
    };

    document.addEventListener('keydown', function (e) {
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (!presenterWin || presenterWin.closed) {
          presenterWin = window.open(
            window.location.href, CHANNEL,
            'width=1280,height=800,menubar=no,toolbar=no,location=no,status=no'
          );
        } else {
          presenterWin.focus();
        }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault(); showSlide(current + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); showSlide(current - 1);
      } else if (e.key === 'n' || e.key === 'N') {
        document.body.classList.toggle('notes-open');
      } else if (e.key === 'o' || e.key === 'O') {
        document.body.classList.toggle('overview-open');
      } else if (e.key === 'l' || e.key === 'L') {
        document.body.classList.toggle('light-theme');
        broadcastState();
      } else if (e.key === 'Home') {
        e.preventDefault(); showSlide(0);
      } else if (e.key === 'End') {
        e.preventDefault(); showSlide(total - 1);
      }
    });

    document.addEventListener('click', function (e) {
      if (document.body.classList.contains('draw-mode')) return;
      var card = e.target.closest('.ov-card');
      if (card) {
        showSlide(parseInt(card.dataset.index, 10));
        return;
      }
      if (e.target.closest('.notes-slide') || e.target.closest('.overview-pane')) return;
      showSlide(current + 1);
    });

    window.addEventListener('beforeunload', function () {
      if (presenterWin && !presenterWin.closed) presenterWin.close();
    });

    showSlide(0);
  }
})();`;


/**
 * @param {import('./parser.js').Slide[]} slides
 * @param {string} docTitle  — filename, used as <title> and suggested save name
 */
export async function exportPresentation(slides, docTitle, { preambleCss = '' } = {}) {
    if (!slides || slides.length === 0) {
        alert('No slides to export.');
        return;
    }

    const [ostrichHeavy, ostrichMed, phosphorWoff2, phosphorCssText, iconoirWoff2, iconoirCssText, faviconB64, annotatorJs] = await Promise.all([
        fetchAsBase64('./fonts/OstrichSans-Heavy.otf', 'font/otf'),
        fetchAsBase64('./fonts/OstrichSans-Medium.otf', 'font/otf'),
        fetchAsBase64('./fonts/phosphor/Phosphor-Light.woff2', 'font/woff2'),
        fetch('./fonts/phosphor/phosphor.css').then(r => r.text()),
        fetchAsBase64('./fonts/iconoir.woff2', 'font/woff2'),
        fetch('./fonts/iconoir-font.css').then(r => r.text()),
        fetchAsBase64('./icons/icon-32.png', 'image/png'),
        fetch('./js/annotator.js').then(r => r.text()),
    ]);

    const patchedPhosphor = phosphorCssText.replace(
        /url\(["']?\.\/Phosphor-Light\.woff2["']?\)/,
        `url("${phosphorWoff2}")`
    );

    const patchedIconoir = iconoirCssText.replace(
        /url\(["']?\.\/iconoir\.woff2["']?\)/,
        `url("${iconoirWoff2}")`
    );

    const fontFacesCss = `@font-face {
  font-family: 'OstrichSans';
  src: url('${ostrichHeavy}') format('opentype');
  font-weight: 900;
}
@font-face {
  font-family: 'OstrichSans';
  src: url('${ostrichMed}') format('opentype');
  font-weight: 500;
}`;

    const total       = slides.length;
    const slidesHtml  = slides.map((s, i) => buildSlideEl(s, i, total)).join('\n');
    const notesHtml   = slides.map((s, i) => buildNotesEl(s, i)).join('\n');
    const overviewHtml = buildOverviewEl(slides);
    const pageTitle   = escapeHtml(docTitle.replace(/\.md$/i, '') || 'Presentation');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
<link rel="icon" href="${faviconB64}" type="image/png" />
<style>
${fontFacesCss}
${patchedPhosphor}
${patchedIconoir}
${EXPORT_CSS}
${preambleCss ? `/* user preamble */\n${preambleCss}` : ''}
</style>
</head>
<body>

<div id="main-view">
  <div class="overview-pane" id="overview-pane">
${overviewHtml}
  </div>
  <div class="main-content">
    <div id="slides-container">
${slidesHtml}
    </div>
    <div id="notes-panel">
${notesHtml}
    </div>
  </div>
  <div id="nav-hint">← → &middot; O overview &middot; N notes &middot; P presenter &middot; L light &middot; D draw &middot; B black &middot; (draw: A R E H T I F)</div>

</div>

<svg id="anno-svg" xmlns="http://www.w3.org/2000/svg"></svg>
<div id="blackout"></div>
<div id="draw-indicator"></div>

<div id="presenter-view">
  <div class="pv-main">
    <div class="pv-current">
      <div class="pv-slide-host" id="pv-current-slide"></div>
    </div>
    <div class="pv-notes" id="pv-notes">
      <span class="pv-notes-empty">No notes</span>
    </div>
  </div>
  <div class="pv-sidebar">
    <div class="pv-controls">
      <button id="pv-prev-btn">&#9664; Prev</button>
      <span id="pv-counter">— / ${total}</span>
      <button id="pv-next-btn">Next &#9654;</button>
    </div>
    <div class="pv-next-section">
      <div class="pv-label">Next slide</div>
      <div class="pv-slide-host" id="pv-next-slide"></div>
    </div>
  </div>
</div>

<script>
${NAVIGATION_JS}
</script>
<script>
${annotatorJs}
</script>
</body>
</html>`;

    const suggestedName = (docTitle.replace(/\.md$/i, '') || 'presentation') + '.html';

    try {
        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({
                suggestedName,
                types: [{ description: 'HTML Document', accept: { 'text/html': ['.html'] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(html);
            await writable.close();
        } else {
            const blob = new Blob([html], { type: 'text/html' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = suggestedName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('[Scream] export error:', err);
            alert(`Export failed: ${err.message}`);
        }
    }
}
