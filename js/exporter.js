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


/**
 * @param {import('./parser.js').Slide[]} slides
 * @param {string} docTitle  — filename, used as <title> and suggested save name
 */
export async function exportPresentation(slides, docTitle, { preambleCss = '' } = {}) {
    if (!slides || slides.length === 0) {
        alert('No slides to export.');
        return;
    }

    const [ostrichHeavy, ostrichMed, phosphorWoff2, phosphorCssText, iconoirWoff2, iconoirCssText, faviconB64, annotatorJs, exportCss, navJs] = await Promise.all([
        fetchAsBase64('./fonts/OstrichSans-Heavy.otf', 'font/otf'),
        fetchAsBase64('./fonts/OstrichSans-Medium.otf', 'font/otf'),
        fetchAsBase64('./fonts/phosphor/Phosphor-Light.woff2', 'font/woff2'),
        fetch('./fonts/phosphor/phosphor.css').then(r => r.text()),
        fetchAsBase64('./fonts/iconoir.woff2', 'font/woff2'),
        fetch('./fonts/iconoir-font.css').then(r => r.text()),
        fetchAsBase64('./icons/icon-32.png', 'image/png'),
        fetch('./js/annotator.js').then(r => r.text()),
        fetch('./css/export.css').then(r => r.text()),
        fetch('./js/export-nav.js').then(r => r.text()),
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
${exportCss}
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
  <div id="nav-hint">← → &middot; 1/2/3 scale &middot; O overview &middot; N notes &middot; P presenter &middot; L light &middot; D draw &middot; B black &middot; ? help</div>

</div>

<svg id="anno-svg" xmlns="http://www.w3.org/2000/svg"></svg>
<div id="blackout"></div>
<div id="draw-indicator"></div>

<div id="help-overlay">
  <div class="help-box">
    <h2>Keyboard shortcuts</h2>
    <div class="help-section">
      <div class="help-section-title">Navigation</div>
      <div class="help-grid">
        <span class="help-key">← / → / Space</span><span class="help-desc">Previous / next slide</span>
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
</div>

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
${navJs}
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
            const file = new File([blob], suggestedName, { type: 'text/html' });
            if (navigator.share && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: suggestedName });
            } else {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = suggestedName;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('[Scream] export error:', err);
            alert(`Export failed: ${err.message}`);
        }
    }
}
