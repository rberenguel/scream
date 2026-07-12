/**
 * Parses markdown where every `# ` line is a slide.
 * Everything between two `# ` lines is "notes" — visible in editor, not in presentation.
 *
 * @typedef {{ title: string, notes: string, startLine: number, endLine: number }} Slide
 */

/**
 * Extract CSS from a ```css fenced block that appears before the first slide.
 * @param {string} text
 * @returns {string}
 */
export function parsePreambleCss(text) {
    const firstSlide = /^#\s/m.exec(text);
    const before = firstSlide ? text.slice(0, firstSlide.index) : text;
    const m = before.match(/```css\s*\n([\s\S]*?)\n```/);
    return m ? m[1].trim() : '';
}

/**
 * @param {string} markdown
 * @returns {Slide[]}
 */
export function parseSlides(markdown) {
    const lines = markdown.split('\n');
    const slides = [];
    let current = null;

    for (let i = 0; i < lines.length; i++) {
        if (/^#\s/.test(lines[i])) {
            if (current) {
                current.endLine = i - 1;
                current.notes = lines.slice(current.startLine + 1, i).join('\n').trim();
                slides.push(current);
            }
            current = {
                title: lines[i].replace(/^#+\s+/, '').trim(),
                notes: '',
                startLine: i,
                endLine: i,
            };
        }
    }

    if (current) {
        current.endLine = lines.length - 1;
        current.notes = lines.slice(current.startLine + 1).join('\n').trim();
        slides.push(current);
    }

    return slides;
}

/**
 * Returns the index of the slide the cursor line falls in, or -1 if none.
 * @param {Slide[]} slides
 * @param {number} cursorLine  0-based
 * @returns {number}
 */
export function slideAtLine(slides, cursorLine) {
    // Walk backwards: the slide that started most recently before the cursor
    for (let i = slides.length - 1; i >= 0; i--) {
        if (cursorLine >= slides[i].startLine) return i;
    }
    return slides.length > 0 ? 0 : -1;
}

/**
 * Move the slide at `fromIndex` to `toIndex`, rewriting the raw markdown.
 * Blocks (including any notes between `#` lines) are moved together.
 *
 * @param {string} markdown
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {string}
 */
export function reorderSlides(markdown, fromIndex, toIndex) {
    if (fromIndex === toIndex) return markdown;

    const slides = parseSlides(markdown);
    const n = slides.length;
    if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n) return markdown;

    const lines = markdown.split('\n');
    const preamble = n > 0 ? lines.slice(0, slides[0].startLine) : [];
    const blocks = slides.map(s => lines.slice(s.startLine, s.endLine + 1));

    const reordered = [...blocks];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    // Ensure every block except the last ends with exactly one blank line,
    // so that the `#` header of the next block is always preceded by a blank line.
    const result = [...preamble];
    reordered.forEach((block, i) => {
        result.push(...block);
        if (i < reordered.length - 1 && result[result.length - 1] !== '') {
            result.push('');
        }
    });

    return result.join('\n');
}
