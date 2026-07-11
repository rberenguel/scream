/**
 * preview.js — renders the current slide in the big-text preview pane.
 *
 * Supports:
 *   - Inline markdown (*italic*, **bold**, `code`)
 *   - :icon-name: shortcut → Phosphor Light icon (ligature-based)
 */

const contentEl = () => document.getElementById('slide-content');
const badgeEl   = () => document.getElementById('slide-index-badge');

/**
 * Convert :icon-name: sequences to Phosphor icons.
 * Phosphor uses compound CSS classes + ::before pseudo-element, so the element
 * must be empty — the icon glyph comes entirely from CSS, not text content.
 *
 * Supports both :chat: and :ph-chat: (ph- prefix is normalised away).
 * Must run AFTER marked.parseInline so marked never sees the raw HTML tags.
 *
 * @param {string} html  - already-parsed HTML string
 * @returns {string}
 */
function expandIcons(html) {
    return html.replace(/:([a-z][a-z0-9-]+):/g, (_, name) => {
        const cls = name.startsWith('ph-') ? name : `ph-${name}`;
        return `<i class="ph-light ${cls}" aria-hidden="true"></i>`;
    });
}

/**
 * @param {string|null} title   - raw markdown title text (after #)
 * @param {number}      index   - 0-based slide index
 * @param {number}      total
 */
export function renderPreview(title, index, total) {
    const el = contentEl();
    if (!el) return;

    if (!title) {
        el.innerHTML = '—';
        el.className = 'empty';
        el.style.fontSize = '';
        _clearBadge();
        return;
    }

    // Parse inline markdown first, then expand icons in the resulting HTML
    el.innerHTML = expandIcons(marked.parseInline(title));
    el.className = '';

    // Scale font by the visible text length (strip tags for measurement)
    const textLen = el.textContent.length;
    if (textLen > 60) {
        el.style.fontSize = '5cqi';
    } else if (textLen > 35) {
        el.style.fontSize = '7cqi';
    } else if (textLen > 20) {
        el.style.fontSize = '9cqi';
    } else {
        el.style.fontSize = '';   // default 11cqi from CSS
    }

    _setBadge(index, total);
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
