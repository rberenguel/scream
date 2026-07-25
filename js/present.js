import { buildSlideEl, buildNotesEl, buildOverviewEl, buildPresentHtml } from './exporter.js';

const HELP_HTML = `<div id="help-overlay">
  <div class="help-box">
    <h2>Keyboard shortcuts</h2>
    <div class="help-section">
      <div class="help-section-title">Navigation</div>
      <div class="help-grid">
        <span class="help-key">&#8592; / &#8594; / Space</span><span class="help-desc">Previous / next slide</span>
        <span class="help-key">Home / End</span><span class="help-desc">First / last slide</span>
        <span class="help-key">Click</span><span class="help-desc">Next slide</span>
      </div>
    </div>
    <div class="help-section">
      <div class="help-section-title">View</div>
      <div class="help-grid">
        <span class="help-key">1 / 2 / 3</span><span class="help-desc">Slide scale — full / medium / small</span>
        <span class="help-key">O</span><span class="help-desc">Toggle slide overview sidebar</span>
        <span class="help-key">N</span><span class="help-desc">Toggle speaker notes panel</span>
        <span class="help-key">P</span><span class="help-desc">Open presenter window</span>
        <span class="help-key">L</span><span class="help-desc">Toggle light / dark theme</span>
        <span class="help-key">Escape</span><span class="help-desc">Exit present mode</span>
      </div>
    </div>
    <div class="help-section">
      <div class="help-section-title">Annotation (press D to enter/exit draw mode)</div>
      <div class="help-grid">
        <span class="help-key">D</span><span class="help-desc">Enter / exit draw mode</span>
        <span class="help-key">B</span><span class="help-desc">Blackout screen (draw on black)</span>
        <span class="help-key">A / R / E / H</span><span class="help-desc">Arrow / rect / ellipse / highlight</span>
        <span class="help-key">T</span><span class="help-desc">Text tool</span>
        <span class="help-key">I</span><span class="help-desc">Interact — drag existing shapes</span>
        <span class="help-key">F</span><span class="help-desc">Toggle filled shapes</span>
        <span class="help-key">C</span><span class="help-desc">Color picker (then r/o/y/b/g/w)</span>
        <span class="help-key">X</span><span class="help-desc">Clear all annotations</span>
        <span class="help-key">Backspace</span><span class="help-desc">Delete selected shape</span>
        <span class="help-key">Escape</span><span class="help-desc">Exit draw mode</span>
      </div>
    </div>
    <div class="help-footer">press ? or click outside to close</div>
  </div>
</div>`;

let _active = false;
let _savedBodyClass = '';
let _escHandler = null;

export function isPresentActive() { return _active; }

export async function enterPresent(slides, startIndex, preambleCss) {
    if (_active || !slides.length) return;
    _active = true;
    _savedBodyClass = document.body.className;

    const overlay = document.getElementById('present-overlay');
    const total = slides.length;

    const A = window.SCREAM_ASSETS;
    const [exportCss, navJs, annotatorJs, presentHtml] = await Promise.all([
        A ? Promise.resolve(A.exportCss)   : fetch('./css/export.css').then(r => r.text()),
        A ? Promise.resolve(A.navJs)       : fetch('./js/export-nav.js').then(r => r.text()),
        A ? Promise.resolve(A.annotatorJs) : fetch('./js/annotator.js').then(r => r.text()),
        buildPresentHtml(slides, { preambleCss, startIndex }),
    ]);

    // Blob URL for P-key presenter window (uses absolute font paths, works standalone)
    window._presentUrl = URL.createObjectURL(new Blob([presentHtml], { type: 'text/html' }));
    window._startSlide = startIndex;

    // Inject export CSS into <head> so it's cleanly removable on exit.
    // Also suppress the editor's #help-overlay from appearing when body.help-open
    // is set (export.css raises its z-index to 500, which would put it over us).
    const styleEl = document.createElement('style');
    styleEl.id = 'present-export-css';
    styleEl.textContent = exportCss
        + (preambleCss ? '\n' + preambleCss : '')
        + '\nbody.help-open > #help-overlay { display: none !important; }';
    document.head.appendChild(styleEl);

    // Build slide DOM
    const slidesHtml   = slides.map((s, i) => buildSlideEl(s, i, total)).join('\n');
    const notesHtml    = slides.map((s, i) => buildNotesEl(s, i)).join('\n');
    const overviewHtml = buildOverviewEl(slides);

    overlay.innerHTML = `
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
  <div id="nav-hint">&#8592; &#8594; &middot; 1/2/3 scale &middot; O overview &middot; N notes &middot; P presenter &middot; L light &middot; D draw &middot; B black &middot; ? help &middot; Esc exit</div>
</div>
<svg id="anno-svg" xmlns="http://www.w3.org/2000/svg"></svg>
<div id="blackout"></div>
<div id="draw-indicator"></div>
${HELP_HTML}`;

    // Register Escape handler in capture phase BEFORE injecting scripts.
    // The annotator also uses capture and would otherwise remove draw-mode first,
    // making our check see it as inactive. Registering earlier guarantees we fire first.
    _escHandler = (e) => {
        if (e.key !== 'Escape') return;
        if (document.body.classList.contains('help-open')) return;
        if (document.body.classList.contains('draw-mode')) return;
        exitPresent();
    };
    document.addEventListener('keydown', _escHandler, true);

    // Scripts execute immediately; slide DOM is already in place when they run
    const s1 = document.createElement('script');
    s1.textContent = navJs;
    overlay.appendChild(s1);

    const s2 = document.createElement('script');
    s2.textContent = annotatorJs;
    overlay.appendChild(s2);

    overlay.classList.remove('hidden');
}

export function exitPresent() {
    if (!_active) return;
    _active = false;

    // Let stale export-nav instances close their BroadcastChannels cleanly
    document.dispatchEvent(new CustomEvent('scream:exit-present'));

    document.getElementById('present-export-css')?.remove();

    const overlay = document.getElementById('present-overlay');
    overlay.innerHTML = '';
    overlay.className = 'hidden';

    // Restore body classes (notes-open, overview-open, light-theme, draw-mode, etc.)
    document.body.className = _savedBodyClass;

    delete window._startSlide;
    if (window._presentUrl) {
        URL.revokeObjectURL(window._presentUrl);
        delete window._presentUrl;
    }

    if (_escHandler) {
        document.removeEventListener('keydown', _escHandler, true);
        _escHandler = null;
    }
}
