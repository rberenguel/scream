// scream.go — go run scream.go input.md [-o output.html]
// Converts a Scream markdown presentation to a standalone HTML file,
// identical to the browser's "Export HTML" output.
//
// Run from the scream project root (assets are embedded at compile time):
//   go run scream.go my-talk.md
//   go run scream.go my-talk.md -o talk.html
package main

import (
	"encoding/base64"
	_ "embed"
	"flag"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ── Embedded assets ───────────────────────────────────────────────────────────

//go:embed fonts/OstrichSans-Heavy.otf
var fontHeavy []byte

//go:embed fonts/OstrichSans-Medium.otf
var fontMed []byte

//go:embed fonts/phosphor/Phosphor-Light.woff2
var phosphorWoff2 []byte

//go:embed fonts/phosphor/phosphor.css
var phosphorCss []byte

//go:embed fonts/iconoir.woff2
var iconoirWoff2 []byte

//go:embed fonts/iconoir-font.css
var iconoirCss []byte

//go:embed icons/icon-32.png
var faviconPng []byte

//go:embed css/export.css
var exportCss []byte

//go:embed js/export-nav.js
var exportNavJs []byte

//go:embed js/annotator.js
var annotatorJs []byte

// ── Inline markdown parser ────────────────────────────────────────────────────

// parseInline converts inline markdown to HTML.
// Handles: **bold**, *italic*, `code`, ![alt](src), [text](url).
// Raw <html> tags and &entities; are passed through unchanged.
func parseInline(s string) string {
	var sb strings.Builder
	i := 0
	n := len(s)
	for i < n {
		c := s[i]

		// Pass through raw HTML tags (<br>, <strong>, etc.)
		if c == '<' {
			end := strings.IndexByte(s[i:], '>')
			if end >= 0 {
				sb.WriteString(s[i : i+end+1])
				i += end + 1
				continue
			}
			sb.WriteString("&lt;")
			i++
			continue
		}

		if c == '&' {
			// Pass through &entity; sequences
			end := strings.IndexByte(s[i:], ';')
			if end >= 0 && end < 12 {
				sb.WriteString(s[i : i+end+1])
				i += end + 1
				continue
			}
			sb.WriteString("&amp;")
			i++
			continue
		}

		if c == '>' {
			sb.WriteString("&gt;")
			i++
			continue
		}

		// Bold **...**
		if c == '*' && i+1 < n && s[i+1] == '*' {
			if end := strings.Index(s[i+2:], "**"); end >= 0 {
				sb.WriteString("<strong>")
				sb.WriteString(parseInline(s[i+2 : i+2+end]))
				sb.WriteString("</strong>")
				i += 4 + end
				continue
			}
		}

		// Italic *...*
		if c == '*' {
			if end := strings.IndexByte(s[i+1:], '*'); end >= 0 {
				sb.WriteString("<em>")
				sb.WriteString(parseInline(s[i+1 : i+1+end]))
				sb.WriteString("</em>")
				i += 2 + end
				continue
			}
		}

		// Code `...`
		if c == '`' {
			if end := strings.IndexByte(s[i+1:], '`'); end >= 0 {
				sb.WriteString("<code>")
				sb.WriteString(html.EscapeString(s[i+1 : i+1+end]))
				sb.WriteString("</code>")
				i += 2 + end
				continue
			}
		}

		// Image ![alt](src)
		if c == '!' && i+1 < n && s[i+1] == '[' {
			if tag, adv := parseMdImg(s[i:]); adv > 0 {
				sb.WriteString(tag)
				i += adv
				continue
			}
		}

		// Link [text](url)
		if c == '[' {
			if tag, adv := parseMdLink(s[i:]); adv > 0 {
				sb.WriteString(tag)
				i += adv
				continue
			}
		}

		sb.WriteByte(c)
		i++
	}
	return sb.String()
}

// parseMdImg parses ![alt](src) at s[0], returns (html, advance) or ("", 0).
func parseMdImg(s string) (string, int) {
	altEnd := strings.IndexByte(s[2:], ']')
	if altEnd < 0 {
		return "", 0
	}
	altEnd += 2
	if altEnd+1 >= len(s) || s[altEnd+1] != '(' {
		return "", 0
	}
	srcStart := altEnd + 2
	srcEnd := strings.IndexByte(s[srcStart:], ')')
	if srcEnd < 0 {
		return "", 0
	}
	srcEnd += srcStart
	alt := s[2:altEnd]
	src := s[srcStart:srcEnd]
	return `<img src="` + html.EscapeString(src) + `" alt="` + html.EscapeString(alt) + `">`, srcEnd + 1
}

// parseMdLink parses [text](url) at s[0], returns (html, advance) or ("", 0).
func parseMdLink(s string) (string, int) {
	textEnd := strings.IndexByte(s[1:], ']')
	if textEnd < 0 {
		return "", 0
	}
	textEnd += 1
	if textEnd+1 >= len(s) || s[textEnd+1] != '(' {
		return "", 0
	}
	urlStart := textEnd + 2
	urlEnd := strings.IndexByte(s[urlStart:], ')')
	if urlEnd < 0 {
		return "", 0
	}
	urlEnd += urlStart
	text := parseInline(s[1:textEnd])
	href := s[urlStart:urlEnd]
	return `<a href="` + html.EscapeString(href) + `">` + text + `</a>`, urlEnd + 1
}

// ── Block markdown parser ─────────────────────────────────────────────────────

var (
	reHeading    = regexp.MustCompile(`^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$`)
	reULItem     = regexp.MustCompile(`^[-*+]\s+(.+)$`)
	reOLItem     = regexp.MustCompile(`^\d+\.\s+(.+)$`)
	reFenceOpen  = regexp.MustCompile("^```(.*)$")
	reHR         = regexp.MustCompile(`^(?:[-]{3,}|[*]{3,}|[_]{3,})\s*$`)
	reBlockquote = regexp.MustCompile(`^>\s?(.*)$`)
)

// parseMarkdown converts block markdown to HTML (for slide notes).
func parseMarkdown(md string) string {
	lines := strings.Split(strings.TrimSpace(md), "\n")
	var sb strings.Builder
	i, n := 0, len(lines)

	for i < n {
		line := lines[i]

		if strings.TrimSpace(line) == "" {
			i++
			continue
		}

		// Fenced code block
		if m := reFenceOpen.FindStringSubmatch(line); m != nil {
			lang := strings.TrimSpace(m[1])
			i++
			var code []string
			for i < n && !reFenceOpen.MatchString(lines[i]) {
				code = append(code, lines[i])
				i++
			}
			if i < n {
				i++ // closing fence
			}
			langAttr := ""
			if lang != "" {
				langAttr = ` class="language-` + html.EscapeString(lang) + `"`
			}
			sb.WriteString("<pre><code" + langAttr + ">" +
				html.EscapeString(strings.Join(code, "\n")) +
				"</code></pre>\n")
			continue
		}

		// ATX heading
		if m := reHeading.FindStringSubmatch(line); m != nil {
			lvl := len(m[1])
			fmt.Fprintf(&sb, "<h%d>%s</h%d>\n", lvl, parseInline(m[2]), lvl)
			i++
			continue
		}

		// Horizontal rule
		if reHR.MatchString(line) {
			sb.WriteString("<hr>\n")
			i++
			continue
		}

		// Blockquote
		if reBlockquote.MatchString(line) {
			var qlines []string
			for i < n && reBlockquote.MatchString(lines[i]) {
				qlines = append(qlines, reBlockquote.FindStringSubmatch(lines[i])[1])
				i++
			}
			sb.WriteString("<blockquote>\n" + parseMarkdown(strings.Join(qlines, "\n")) + "</blockquote>\n")
			continue
		}

		// Unordered list
		if reULItem.MatchString(line) {
			sb.WriteString("<ul>\n")
			for i < n {
				if m := reULItem.FindStringSubmatch(lines[i]); m != nil {
					sb.WriteString("  <li>" + parseInline(m[1]) + "</li>\n")
					i++
				} else if strings.TrimSpace(lines[i]) == "" {
					i++
					break
				} else {
					break
				}
			}
			sb.WriteString("</ul>\n")
			continue
		}

		// Ordered list
		if reOLItem.MatchString(line) {
			sb.WriteString("<ol>\n")
			for i < n {
				if m := reOLItem.FindStringSubmatch(lines[i]); m != nil {
					sb.WriteString("  <li>" + parseInline(m[1]) + "</li>\n")
					i++
				} else if strings.TrimSpace(lines[i]) == "" {
					i++
					break
				} else {
					break
				}
			}
			sb.WriteString("</ol>\n")
			continue
		}

		// Paragraph: collect lines until blank or block-level element
		var plines []string
		for i < n {
			l := lines[i]
			if strings.TrimSpace(l) == "" {
				break
			}
			if reHeading.MatchString(l) || reFenceOpen.MatchString(l) ||
				reHR.MatchString(l) || reULItem.MatchString(l) || reOLItem.MatchString(l) {
				break
			}
			plines = append(plines, l)
			i++
		}
		if len(plines) > 0 {
			sb.WriteString("<p>" + parseInline(strings.Join(plines, " ")) + "</p>\n")
		}
	}

	return sb.String()
}

// ── Slide parser ──────────────────────────────────────────────────────────────

type Slide struct {
	Title      string
	CleanTitle string
	Classes    []string
	Notes      string
}

var reInlineStyleStrip = regexp.MustCompile(`\.([a-zA-Z_-][a-zA-Z0-9_-]*)\s*\{([^}]*)\}`)

func stripInlineStyles(s string) string {
	return strings.TrimSpace(reInlineStyleStrip.ReplaceAllString(s, "$2"))
}

// extractClasses splits leading .className tokens from the slide title.
// A token is only a class if it is NOT immediately followed by '{' (which would
// make it an inline style rather than a layout class).
func extractClasses(raw string) (classes []string, title string) {
	i := 0
	for i < len(raw) && raw[i] == '.' {
		j := i + 1
		for j < len(raw) && isClassChar(raw[j]) {
			j++
		}
		if j == i+1 {
			break // lone '.' with no name
		}
		// Skip whitespace after the name
		k := j
		for k < len(raw) && (raw[k] == ' ' || raw[k] == '\t') {
			k++
		}
		// If followed by '{' it's an inline style, stop consuming classes
		if k < len(raw) && raw[k] == '{' {
			break
		}
		classes = append(classes, raw[i+1:j])
		i = k
	}
	return classes, strings.TrimSpace(raw[i:])
}

func isClassChar(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
		(c >= '0' && c <= '9') || c == '-' || c == '_'
}

func parseSlides(md string) []Slide {
	lines := strings.Split(md, "\n")
	var slides []Slide
	var cur *Slide
	curStart := 0

	flush := func(end int) {
		if cur == nil {
			return
		}
		cur.Notes = strings.TrimSpace(strings.Join(lines[curStart+1:end], "\n"))
		slides = append(slides, *cur)
		cur = nil
	}

	for i, line := range lines {
		if strings.HasPrefix(line, "# ") || line == "#" {
			flush(i)
			raw := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(line, "# "), "#"))
			classes, title := extractClasses(raw)
			cur = &Slide{
				Title:      title,
				CleanTitle: stripInlineStyles(title),
				Classes:    classes,
			}
			curStart = i
		}
	}
	flush(len(lines))
	return slides
}

var rePreambleFence = regexp.MustCompile("(?s)```css\\s*\\n([\\s\\S]*?)\\n```")
var reFirstSlide = regexp.MustCompile(`(?m)^#\s`)

func parsePreambleCss(md string) string {
	loc := reFirstSlide.FindStringIndex(md)
	before := md
	if loc != nil {
		before = md[:loc[0]]
	}
	if m := rePreambleFence.FindStringSubmatch(before); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// ── Icon and inline-style expanders ──────────────────────────────────────────

var (
	reIconColon  = regexp.MustCompile(`:([a-z][a-z0-9-]+):`)
	reInlineSpan = regexp.MustCompile(`\.([a-zA-Z_-][a-zA-Z0-9_-]*)\s*\{([^}]*)\}`)
	reStripTags  = regexp.MustCompile(`<[^>]+>`)
	reImgTag     = regexp.MustCompile(`<img\s[^>]*?>`)
	reImgSrc     = regexp.MustCompile(`src="([^"]*)"`)
	reImgAlt     = regexp.MustCompile(`alt="([^"]*)"`)
)

func expandIcons(s string) string {
	return reIconColon.ReplaceAllStringFunc(s, func(match string) string {
		name := reIconColon.FindStringSubmatch(match)[1]
		if strings.HasPrefix(name, "in-") {
			return `<i class="iconoirfont-` + name[3:] + `" aria-hidden="true"></i>`
		}
		cls := name
		if !strings.HasPrefix(name, "ph-") {
			cls = "ph-" + name
		}
		return `<i class="ph-light ` + cls + `" aria-hidden="true"></i>`
	})
}

func expandInlineStyles(s string) string {
	return reInlineSpan.ReplaceAllString(s, `<span class="$1">$2</span>`)
}

func stripTags(s string) string {
	return reStripTags.ReplaceAllString(s, "")
}

// ── Slide content layout builder ──────────────────────────────────────────────

type imgInfo struct {
	full string
	src  string // unescaped
	alt  string // unescaped
}

func findImgs(titleHtml string) []imgInfo {
	var result []imgInfo
	for _, full := range reImgTag.FindAllString(titleHtml, -1) {
		var img imgInfo
		img.full = full
		if m := reImgSrc.FindStringSubmatch(full); m != nil {
			img.src = html.UnescapeString(m[1])
		}
		if m := reImgAlt.FindStringSubmatch(full); m != nil {
			img.alt = html.UnescapeString(m[1])
		}
		result = append(result, img)
	}
	return result
}

// buildSlideContentHtml mirrors exporter.js buildSlideContentEl, producing
// layout-fill / layout-bg / layout-split / plain HTML from the rendered title.
func buildSlideContentHtml(titleHtml string) string {
	imgs := findImgs(titleHtml)

	// Single non-layout image with no other text → fill
	if len(imgs) == 1 {
		img := imgs[0]
		if !strings.HasPrefix(img.alt, "bg") &&
			!strings.HasPrefix(img.alt, "left") &&
			!strings.HasPrefix(img.alt, "right") {
			if strings.TrimSpace(stripTags(titleHtml)) == "" {
				return `<div class="slide-content layout-fill" style="background-image: url('` +
					img.src + `')"></div>`
			}
		}
	}

	// Partition into bg / side images
	var bgImgs []imgInfo
	var sideImg *imgInfo
	for idx := range imgs {
		alt := imgs[idx].alt
		if strings.HasPrefix(alt, "bg") {
			bgImgs = append(bgImgs, imgs[idx])
		} else if (strings.HasPrefix(alt, "left") || strings.HasPrefix(alt, "right")) && sideImg == nil {
			sideImg = &imgs[idx]
		}
	}

	if len(bgImgs) > 0 {
		extra := strings.TrimSpace(strings.TrimPrefix(bgImgs[0].alt, "bg"))
		isBgClass := strings.HasPrefix(extra, ".")

		remaining := titleHtml
		var slicesSb strings.Builder
		for _, img := range bgImgs {
			remaining = strings.Replace(remaining, img.full, "", 1)
			classes := "bg-slice"
			if isBgClass {
				for _, c := range strings.Fields(extra) {
					if strings.HasPrefix(c, ".") {
						classes += " " + c[1:]
					}
				}
			}
			slice := `<div class="` + classes + `"`
			if img.src != "" {
				slice += ` style="background-image: url('` + img.src + `')"`
			}
			slice += `></div>`
			slicesSb.WriteString("    " + slice + "\n")
		}

		elStyle := ""
		if isBgClass {
			elStyle = ` style="--custom-bg-filter: none"`
		} else if extra != "" {
			elStyle = ` style="--custom-bg-filter: ` + extra + `"`
		}

		return `<div class="slide-content layout-bg"` + elStyle + `>
  <div class="bg-slice-container">
` + slicesSb.String() + `  </div>
  <div class="bg-content-wrapper">` + remaining + `</div>
</div>`
	}

	if sideImg != nil {
		splitClass := "split-left"
		if strings.HasPrefix(sideImg.alt, "right") {
			splitClass = "split-right"
		}
		remaining := strings.Replace(titleHtml, sideImg.full, "", 1)
		return `<div class="slide-content layout-split ` + splitClass + `">
  <div class="split-image-pane" style="background-image: url('` + sideImg.src + `')"></div>
  <div class="split-text-pane">` + remaining + `</div>
</div>`
	}

	// Plain text: scale font by character count (matches JS slideContentFontSize)
	textLen := len([]rune(stripTags(titleHtml)))
	fontSize := ""
	switch {
	case textLen > 60:
		fontSize = "5cqi"
	case textLen > 35:
		fontSize = "7cqi"
	case textLen > 20:
		fontSize = "9cqi"
	}
	style := ""
	if fontSize != "" {
		style = ` style="font-size: ` + fontSize + `"`
	}
	return `<div class="slide-content"` + style + `>` + titleHtml + `</div>`
}

func buildSlideEl(slide Slide, index, total int) string {
	titleMd := strings.ReplaceAll(slide.Title, `\n`, "<br>")
	titleHtml := expandInlineStyles(expandIcons(parseInline(titleMd)))
	contentHtml := buildSlideContentHtml(titleHtml)

	activeClass := ""
	if index == 0 {
		activeClass = " active"
	}
	extraClasses := ""
	if len(slide.Classes) > 0 {
		extraClasses = " " + strings.Join(slide.Classes, " ")
	}

	return fmt.Sprintf(
		`<div class="slide-wrapper%s%s" data-index="%d">
  <div class="slide-preview-box">
    %s
    <div class="slide-badge">%d&thinsp;/&thinsp;%d</div>
  </div>
</div>`, activeClass, extraClasses, index, contentHtml, index+1, total)
}

func buildNotesEl(slide Slide, index int) string {
	noteHtml := ""
	if slide.Notes != "" {
		noteHtml = parseMarkdown(slide.Notes)
	}
	activeClass := ""
	if index == 0 {
		activeClass = " active"
	}
	return fmt.Sprintf(`<div class="notes-slide%s" data-index="%d">%s</div>`,
		activeClass, index, noteHtml)
}

func buildOverviewEl(slides []Slide) string {
	var sb strings.Builder
	for i, s := range slides {
		title := s.CleanTitle
		if title == "" {
			title = s.Title
		}
		if title == "" {
			title = "—"
		}
		activeClass := ""
		if i == 0 {
			activeClass = " active"
		}
		fmt.Fprintf(&sb,
			`<div class="ov-card%s" data-index="%d">
  <span class="ov-num">%d</span>
  <span class="ov-title">%s</span>
</div>
`, activeClass, i, i+1, html.EscapeString(title))
	}
	return sb.String()
}

// ── Asset helpers ─────────────────────────────────────────────────────────────

func toDataURI(data []byte, mime string) string {
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// patchFontURL replaces a relative font url() in CSS with a base64 data URI.
func patchFontURL(css, relPath, dataURI string) string {
	re := regexp.MustCompile(`url\(["']?` + regexp.QuoteMeta(relPath) + `["']?\)`)
	return re.ReplaceAllLiteralString(css, `url("`+dataURI+`")`)
}

// ── Presentation HTML template ────────────────────────────────────────────────

func buildPresentationHtml(slides []Slide, pageTitle, preambleCss string) string {
	heavyB64 := toDataURI(fontHeavy, "font/otf")
	medB64 := toDataURI(fontMed, "font/otf")
	phosphorB64 := toDataURI(phosphorWoff2, "font/woff2")
	iconoirB64 := toDataURI(iconoirWoff2, "font/woff2")
	faviconB64 := toDataURI(faviconPng, "image/png")

	fontFacesCss := `@font-face {
  font-family: 'OstrichSans';
  src: url('` + heavyB64 + `') format('opentype');
  font-weight: 900;
}
@font-face {
  font-family: 'OstrichSans';
  src: url('` + medB64 + `') format('opentype');
  font-weight: 500;
}`

	patchedPhosphor := patchFontURL(string(phosphorCss), "./Phosphor-Light.woff2", phosphorB64)
	patchedIconoir := patchFontURL(string(iconoirCss), "./iconoir.woff2", iconoirB64)

	total := len(slides)
	var slidesSb, notesSb strings.Builder
	for i, s := range slides {
		slidesSb.WriteString(buildSlideEl(s, i, total))
		slidesSb.WriteByte('\n')
		notesSb.WriteString(buildNotesEl(s, i))
		notesSb.WriteByte('\n')
	}
	overviewHtml := buildOverviewEl(slides)

	// Escape </script> inside inlined JS to prevent premature tag closure
	navJs := strings.ReplaceAll(string(exportNavJs), "</script>", `<\/script>`)
	annoJs := strings.ReplaceAll(string(annotatorJs), "</script>", `<\/script>`)

	preambleBlock := ""
	if preambleCss != "" {
		preambleBlock = "/* user preamble */\n" + preambleCss + "\n"
	}

	logoHtml := `<img src="` + faviconB64 + `" class="help-logo" alt="">`
	totalStr := fmt.Sprintf("%d", total)

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>` + html.EscapeString(pageTitle) + `</title>
<link rel="icon" href="` + faviconB64 + `" type="image/png" />
<style>
` + fontFacesCss + `
` + patchedPhosphor + `
` + patchedIconoir + `
` + string(exportCss) + `
` + preambleBlock + `</style>
</head>
<body>

<div id="main-view">
  <div class="overview-pane" id="overview-pane">
` + overviewHtml + `  </div>
  <div class="main-content">
    <div id="slides-container">
` + slidesSb.String() + `    </div>
    <div id="notes-panel">
` + notesSb.String() + `    </div>
  </div>
  <div id="nav-hint">← → &middot; 1/2/3 scale &middot; O overview &middot; N notes &middot; P presenter &middot; L light &middot; D draw &middot; B black &middot; ? help</div>
</div>

<svg id="anno-svg" xmlns="http://www.w3.org/2000/svg"></svg>
<div id="blackout"></div>
<div id="draw-indicator"></div>

<div id="help-overlay">
  <div class="help-box">
    <div class="help-header">` + logoHtml + `<h2>Keyboard shortcuts</h2></div>
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
      <span id="pv-counter">— / ` + totalStr + `</span>
      <button id="pv-next-btn">Next &#9654;</button>
    </div>
    <div class="pv-next-section">
      <div class="pv-label">Next slide</div>
      <div class="pv-slide-host" id="pv-next-slide"></div>
    </div>
  </div>
</div>

<script>
` + navJs + `
</script>
<script>
` + annoJs + `
</script>
</body>
</html>`)

	return sb.String()
}

// ── Entry point ───────────────────────────────────────────────────────────────

func main() {
	outFlag := flag.String("o", "", "output file (default: input name with .html extension)")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: go run scream.go [flags] input.md\n\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	if flag.NArg() < 1 {
		flag.Usage()
		os.Exit(1)
	}

	inPath := flag.Arg(0)
	mdBytes, err := os.ReadFile(inPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	outPath := *outFlag
	if outPath == "" {
		base := filepath.Base(inPath)
		ext := filepath.Ext(base)
		outPath = filepath.Join(filepath.Dir(inPath), base[:len(base)-len(ext)]+".html")
	}

	md := string(mdBytes)
	slides := parseSlides(md)
	if len(slides) == 0 {
		fmt.Fprintln(os.Stderr, "error: no slides found (no '# ' lines)")
		os.Exit(1)
	}

	preambleCss := parsePreambleCss(md)
	base := filepath.Base(inPath)
	ext := filepath.Ext(base)
	pageTitle := base[:len(base)-len(ext)]

	result := buildPresentationHtml(slides, pageTitle, preambleCss)

	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(outPath, []byte(result), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("✓ %s  (%d KB, %d slides)\n", outPath, len(result)/1024, len(slides))
}
