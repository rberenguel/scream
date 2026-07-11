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

function expandIcons(html) {
    return html.replace(/:([a-z][a-z0-9-]+):/g, (_, name) => {
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

function buildSlideEl(slide, index, total) {
    const titleHtml = expandIcons(marked.parseInline(slide.title || ''));
    const tmp = document.createElement('span');
    tmp.innerHTML = titleHtml;
    const textLen = tmp.textContent.length;
    const fontSize = slideContentFontSize(textLen);
    const sizeAttr = fontSize ? ` style="font-size:${fontSize}"` : '';

    return `<div class="slide-wrapper${index === 0 ? ' active' : ''}" data-index="${index}">
  <div class="slide-preview-box">
    <div class="slide-content"${sizeAttr}>${titleHtml}</div>
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
  --slide-bg:   #1a1a1a;
  --slide-text: #bf616a;
  --bg:         #111;
  --text:       #d4d4d4;
  --border:     #434c5e;
  --muted:      #555;
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
  background: #141414;
  border-right: 1px solid #2c2c2c;
  overflow-y: auto;
  transition: width 0.2s ease;
  scrollbar-width: thin;
  scrollbar-color: #2c2c2c transparent;
}

body.overview-open .overview-pane { width: 170px; }

.ov-card {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.5rem 0.65rem;
  cursor: pointer;
  border-bottom: 1px solid #1c1c1c;
  transition: background 0.1s;
  user-select: none;
}

.ov-card:hover  { background: #1e1e1e; }
.ov-card.active { background: #1e2a45; }

.ov-num {
  font-size: 0.55rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  min-width: 1.4em;
  flex-shrink: 0;
  padding-top: 0.1em;
}

.ov-card.active .ov-num { color: #5b7fde; }

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
.ov-card.active .ov-title { color: #fff; }

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
  box-shadow: 0 6px 30px rgba(0,0,0,0.6);
  container-type: inline-size;
  overflow: hidden;
  position: relative;
}

.slide-content {
  padding: 8% 10%;
  text-align: center;
  width: 100%;
  color: var(--slide-text);
  font-family: 'OstrichSans', sans-serif;
  font-size: 11cqi;
  font-weight: 900;
  line-height: 1.1;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  word-break: break-word;
  hyphens: auto;
}

.slide-content strong { color: #ff7043; font-weight: 900; }
.slide-content em     { color: #ebcb8b; font-style: italic; }
.slide-content code {
  font-family: monospace;
  font-size: 0.8em;
  color: #b5cea8;
  background: rgba(255,255,255,0.06);
  padding: 0.05em 0.25em;
  border-radius: 3px;
}

.slide-content .ph-light {
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
  color: #333;
  font-variant-numeric: tabular-nums;
  user-select: none;
  pointer-events: none;
}

/* Notes panel (audience view) */

#notes-panel {
  flex: 0 0 0;
  overflow-y: hidden;
  background: #181818;
  border-top: 1px solid #2c2c2c;
  transition: flex-basis 0.25s ease;
}

body.notes-open #notes-panel {
  flex-basis: 35%;
  overflow-y: auto;
  padding: 1rem 2rem;
}

.notes-slide        { display: none; }
.notes-slide.active { display: block; }

#notes-panel p  { margin: 0.5em 0; line-height: 1.6; font-size: 0.9rem; }
#notes-panel ul,
#notes-panel ol { padding-left: 1.5em; line-height: 1.6; font-size: 0.9rem; }
.pv-notes p     { margin: 0.5em 0; }
.pv-notes ul,
.pv-notes ol    { padding-left: 1.5em; }
#notes-panel code, .pv-notes code {
  font-family: monospace;
  font-size: 0.85em;
  color: #b5cea8;
  background: rgba(255,255,255,0.06);
  padding: 0.1em 0.3em;
  border-radius: 3px;
}
#notes-panel strong, .pv-notes strong { color: #ebcb8b; }

/* Keyboard hint */

#nav-hint {
  position: fixed;
  bottom: 6px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: #2a2a2a;
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
  background: #0d0d0d;
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
  background: #181818;
  border: 1px solid #2c2c2c;
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
  background: #141414;
  border-left: 1px solid #2c2c2c;
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
  background: #222;
  border: 1px solid #333;
  color: var(--text);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.pv-controls button:hover { background: #2c2c2c; }

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
  box-shadow: 0 2px 12px rgba(0,0,0,0.5);
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
      cur:  wrappers[current].querySelector('.slide-preview-box').outerHTML,
      nxt:  wrappers[next].querySelector('.slide-preview-box').outerHTML,
      notes: noteSlides[current].innerHTML,
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
export async function exportPresentation(slides, docTitle) {
    if (!slides || slides.length === 0) {
        alert('No slides to export.');
        return;
    }

    const [ostrichHeavy, ostrichMed, phosphorWoff2, phosphorCssText, faviconB64, annotatorJs] = await Promise.all([
        fetchAsBase64('./fonts/OstrichSans-Heavy.otf', 'font/otf'),
        fetchAsBase64('./fonts/OstrichSans-Medium.otf', 'font/otf'),
        fetchAsBase64('./fonts/phosphor/Phosphor-Light.woff2', 'font/woff2'),
        fetch('./fonts/phosphor/phosphor.css').then(r => r.text()),
        fetchAsBase64('./icons/icon-32.png', 'image/png'),
        fetch('./js/annotator.js').then(r => r.text()),
    ]);

    const patchedPhosphor = phosphorCssText.replace(
        /url\(["']?\.\/Phosphor-Light\.woff2["']?\)/,
        `url("${phosphorWoff2}")`
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
${EXPORT_CSS}
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
  <div id="nav-hint">← → &middot; O overview &middot; N notes &middot; P presenter &middot; D draw &middot; B black &middot; (draw: A R E H T I F)</div>

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
