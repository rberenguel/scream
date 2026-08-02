/**
 * preview.js — renders the current slide in the big-text preview pane.
 *
 * Supports:
 *   - Inline markdown (*italic*, **bold**, `code`)
 *   - :icon-name: shortcut → Phosphor Light icon (ligature-based)
 */

const contentEl = () => document.getElementById('slide-preview').firstElementChild;
const badgeEl   = () => document.getElementById('slide-index-badge');

/**
 * Convert :ph-NAME: (Phosphor) and :in-NAME: (Iconoir) sequences to icon elements.
 * Both use font + CSS ::before — element must be empty.
 * Bare :NAME: defaults to Phosphor for backward compat.
 * Must run AFTER marked.parseInline so marked never sees the raw HTML tags.
 *
 * @param {string} html
 * @returns {string}
 */
/**
 * Wrap .classname { content } in <span class="classname">content</span>.
 * Runs after marked so the content may already contain HTML (bold, icons, etc).
 * @param {string} html
 * @returns {string}
 */
export function expandInlineStyles(html) {
    return html.replace(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)\s*\{([^}]*)\}/g, (_, cls, body) =>
        `<span class="${cls}">${body}</span>`
    );
}

export function expandIcons(html) {
    return html.replace(/:([a-z][a-z0-9-]+):/g, (_, name) => {
        if (name.startsWith('in-')) {
            const cls = `iconoirfont-${name.slice(3)}`;
            return `<i class="${cls}" aria-hidden="true"></i>`;
        }
        const cls = name.startsWith('ph-') ? name : `ph-${name}`;
        return `<i class="ph-light ${cls}" aria-hidden="true"></i>`;
    });
}

/**
 * @param {string|null} title   - raw markdown title text (after #)
 * @param {number}      index   - 0-based slide index
 * @param {number}      total
 */
export function renderPreview(title, index, total, hideNumber = false) {
    const el = contentEl();
    if (!el) return;

    if (!title) {
        const empty = document.createElement('div');
        empty.className = 'slide-content empty';
        empty.textContent = '—';
        el.replaceWith(empty);
        _clearBadge();
        return;
    }

    const html = expandInlineStyles(expandIcons(marked.parseInline(title.replace(/\\n/g, '<br>'))));
    el.replaceWith(buildSlideContent(html));
    if (hideNumber) _clearBadge(); else _setBadge(index, total);
}

function splitAtBr(shadow) {
    // Promote all nested <br> to direct children of shadow by splitting their
    // ancestor elements at each <br> boundary.
    let br;
    while ((br = shadow.querySelector(':scope > * br'))) {
        const parent = br.parentElement;
        const before = parent.cloneNode(false);
        const after  = parent.cloneNode(false);
        let past = false;
        for (const child of [...parent.childNodes]) {
            if (child === br) { past = true; continue; }
            (past ? after : before).appendChild(child.cloneNode(true));
        }
        const frag = document.createDocumentFragment();
        if (before.childNodes.length) frag.appendChild(before);
        frag.appendChild(document.createElement('br'));
        if (after.childNodes.length) frag.appendChild(after);
        parent.replaceWith(frag);
    }
    // Group nodes between top-level <br>s into per-line arrays.
    // Bare text nodes are wrapped in <span> so CSS line-height can be controlled.
    const lines = [];
    let current = [];
    for (const node of [...shadow.childNodes]) {
        if (node.tagName === 'BR') {
            lines.push(current);
            current = [];
        } else if (node.nodeType === Node.TEXT_NODE) {
            const span = document.createElement('span');
            span.textContent = node.textContent;
            current.push(span);
        } else {
            current.push(node);
        }
    }
    if (current.length) lines.push(current);
    return lines.filter(l => l.some(n => n.textContent.trim() !== ''));
}

export function buildSlideContent(html) {
    const shadow = document.createElement('div');
    shadow.innerHTML = html;

    const el = document.createElement('div');
    el.className = 'slide-content';

    const allImages = Array.from(shadow.querySelectorAll('img'));

    // Lone image with no layout alt and no other text → simple fill
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
        const extra = bgInfos[0].match[2]?.trim() ?? '';
        const isBgClass = extra.startsWith('.');
        bgInfos.forEach(info => {
            const slice = document.createElement('div');
            slice.className = 'bg-slice';
            if (info.el.src) slice.style.backgroundImage = `url("${info.el.src}")`;
            if (isBgClass) extra.split(/\s+/).forEach(c => c.startsWith('.') && slice.classList.add(c.slice(1)));
            sliceContainer.appendChild(slice);
            (info.el.closest('p') || info.el).remove();
        });
        shadow.querySelectorAll('p').forEach(p => { if (!p.textContent.trim()) p.remove(); });

        const wrapper = document.createElement('div');
        wrapper.className = 'bg-content-wrapper';
        if (isBgClass) el.style.setProperty('--custom-bg-filter', 'none');
        else if (extra) el.style.setProperty('--custom-bg-filter', extra);
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
        const textLen = shadow.textContent.length;
        const fontSize =
            textLen > 60 ? '5cqi' :
            textLen > 35 ? '7cqi' :
            textLen > 20 ? '9cqi' : '';
        if (shadow.querySelector('br')) {
            el.classList.add('multiline');
            el.style.setProperty('--slide-fs', fontSize || '11cqi');
            for (const nodes of splitAtBr(shadow)) {
                const line = document.createElement('div');
                line.className = 'slide-line';
                line.append(...nodes);
                el.appendChild(line);
            }
        } else {
            el.style.fontSize = fontSize;
            el.append(...shadow.childNodes);
        }
    }

    return el;
}

function _setBadge(index, total) {
    let badge = badgeEl();
    if (!badge) {
        const preview = document.getElementById('slide-preview');
        if (!preview) return;
        badge = document.createElement('div');
        badge.id = 'slide-index-badge';
        preview.appendChild(badge);
    }
    badge.textContent = `${index + 1} / ${total}`;
}

function _clearBadge() {
    const badge = badgeEl();
    if (badge) badge.textContent = '';
}
