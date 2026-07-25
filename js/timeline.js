/**
 * timeline.js — drag-to-reorder slide list.
 *
 * Cards are the drop targets. We split each card into top/bottom halves:
 *   - cursor in top half  → indicator above card  (insert before i)
 *   - cursor in bottom half → indicator below card (insert before i+1)
 * A single indicator element is moved around rather than N+1 static hairlines.
 */

let _onReorder = null;
let _onSelect  = null;
let _dragFrom  = -1;
let _dropTarget = -1;   // "insert before" index, or slides.length to append
let _container = null;

/** Singleton indicator element. Created once, reused across renders. */
let _indicator = null;

export function initTimeline({ onReorder, onSelect }) {
    _onReorder = onReorder;
    _onSelect  = onSelect;
}

/**
 * Re-render the timeline list.
 * @param {HTMLElement} container
 * @param {import('./parser.js').Slide[]} slides
 * @param {number} activeIndex
 */
export function renderTimeline(container, slides, activeIndex) {
    _container = container;
    container.innerHTML = '';
    _hideIndicator();

    if (slides.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:1rem 0.85rem;font-size:0.75rem;color:#444;';
        empty.textContent = 'No # headers yet';
        container.appendChild(empty);
        return;
    }

    slides.forEach((slide, i) => {
        const card = document.createElement('div');
        card.className = 'timeline-card' + (i === activeIndex ? ' active' : '');
        card.draggable = true;
        card.dataset.index = i;

        const numEl = document.createElement('span');
        numEl.className = 'card-num';
        numEl.textContent = i + 1;

        const titleEl = document.createElement('span');
        titleEl.className = 'card-title';
        titleEl.textContent = slide.cleanTitle || slide.title || '(untitled)';

        card.appendChild(numEl);
        card.appendChild(titleEl);

        card.addEventListener('click', () => _onSelect?.(i));

        card.addEventListener('dragstart', (e) => {
            _dragFrom = i;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(i));
            requestAnimationFrame(() => card.classList.add('dragging'));
        });

        card.addEventListener('dragend', () => {
            _dragFrom = -1;
            _dropTarget = -1;
            card.classList.remove('dragging');
            _hideIndicator();
        });

        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const rect = card.getBoundingClientRect();
            const insertBefore = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
            _showIndicator(insertBefore, slides.length);
        });

        card.addEventListener('dragleave', (e) => {
            // Only hide if leaving to something outside the container entirely.
            // We don't hide here — the next card's dragover will reposition the indicator,
            // and dragend cleans up if the drop lands outside.
        });

        card.addEventListener('drop', (e) => {
            e.preventDefault();
            if (_dropTarget >= 0) _handleDrop(_dropTarget, slides.length);
            _hideIndicator();
        });

        container.appendChild(card);
    });

    // Also handle drops on the container background (below all cards → append)
    container.addEventListener('dragover', (e) => {
        if (e.target === container) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            _showIndicator(slides.length, slides.length);
        }
    });
    container.addEventListener('drop', (e) => {
        if (e.target === container) {
            e.preventDefault();
            if (_dropTarget >= 0) _handleDrop(_dropTarget, slides.length);
            _hideIndicator();
        }
    });
}

// ── Indicator management ───────────────────────────────────────────────────

function _getIndicator() {
    if (!_indicator) {
        _indicator = document.createElement('div');
        _indicator.className = 'timeline-drop-indicator';
    }
    return _indicator;
}

function _showIndicator(insertBefore, total) {
    if (!_container) return;
    _dropTarget = insertBefore;

    const ind = _getIndicator();
    const cards = _container.querySelectorAll('.timeline-card');

    if (cards.length === 0) return;

    if (insertBefore === 0) {
        _container.insertBefore(ind, cards[0]);
    } else if (insertBefore >= total) {
        _container.appendChild(ind);
    } else {
        _container.insertBefore(ind, cards[insertBefore]);
    }

    ind.classList.add('visible');
}

function _hideIndicator() {
    _dropTarget = -1;
    if (_indicator) {
        _indicator.classList.remove('visible');
        _indicator.remove();
    }
}

// ── Drop logic ─────────────────────────────────────────────────────────────

function _handleDrop(insertBefore, total) {
    if (_dragFrom < 0) return;
    const from = _dragFrom;
    let to = insertBefore;

    // No-op: dropping right before or right after the dragged card
    if (to === from || to === from + 1) return;

    // "insert before index X" after removing `from`:
    // if X > from, the removal shifts everything left by 1
    if (to > from) to = to - 1;

    _onReorder?.(from, to);
}
