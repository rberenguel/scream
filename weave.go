// weave.go — produces dist/scream.html: a single-file, zero-dependency Scream editor.
//
//   go run weave.go
//   go run weave.go --out scream.html
//
// What it does:
//   1. Inlines CSS (with font URLs replaced by base64 data URIs)
//   2. Inlines libs/marked.min.js as a plain <script>
//   3. Injects window.SCREAM_ASSETS with pre-baked fonts/CSS/JS for the exporter
//   4. Bundles the ES-module graph (js/main.js + transitive imports) into an IIFE
//   5. Embeds manifest.json (icons inlined) as a data URI — keeps PWA installable
//   6. Inlines favicon, removes SW block
//   7. Injects a Content-Security-Policy meta tag (SHA-256 hashes of all inline blocks)

package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ── Helpers ───────────────────────────────────────────────────────────────────

func readText(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		panic(fmt.Sprintf("read %s: %v", path, err))
	}
	return string(b)
}

func readBase64(path, mime string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		panic(fmt.Sprintf("read %s: %v", path, err))
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(b)
}

func readManifestVersion(rootDir string) string {
	b, err := os.ReadFile(filepath.Join(rootDir, "manifest.json"))
	if err != nil {
		return "dev"
	}
	var m struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(b, &m); err != nil || m.Version == "" {
		return "dev"
	}
	return m.Version
}

func jsonStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// mimeForExt returns MIME type for common font/image extensions.
func mimeForExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".woff2":
		return "font/woff2"
	case ".woff":
		return "font/woff"
	case ".otf":
		return "font/otf"
	case ".ttf":
		return "font/ttf"
	case ".png":
		return "image/png"
	case ".svg":
		return "image/svg+xml"
	}
	return ""
}

// patchCssFontUrls replaces url(relative/path) in CSS with base64 data URIs.
// cssDir is the directory that the CSS file lives in (for resolving relative URLs).
func patchCssFontUrls(css, cssDir string) string {
	re := regexp.MustCompile(`url\(["']?(\.\.?/[^"')]+)["']?\)`)
	return re.ReplaceAllStringFunc(css, func(match string) string {
		m := re.FindStringSubmatch(match)
		if m == nil {
			return match
		}
		rel := m[1]
		absPath := filepath.Join(cssDir, rel)
		mime := mimeForExt(filepath.Ext(rel))
		if mime == "" {
			return match
		}
		b, err := os.ReadFile(absPath)
		if err != nil {
			return match
		}
		return `url("data:` + mime + `;base64,` + base64.StdEncoding.EncodeToString(b) + `")`
	})
}

// ── SCREAM_ASSETS block ───────────────────────────────────────────────────────

// buildScreamAssets emits a <script> block that sets window.SCREAM_ASSETS.
// These are pre-baked at weave time so exporter.js / present.js can work without
// any fetch() calls (needed in a file:// context).
func buildScreamAssets(rootDir string) string {
	type asset struct {
		key   string
		value string
	}
	assets := []asset{
		{"ostrichHeavy", readBase64(filepath.Join(rootDir, "fonts/OstrichSans-Heavy.otf"), "font/otf")},
		{"ostrichMed", readBase64(filepath.Join(rootDir, "fonts/OstrichSans-Medium.otf"), "font/otf")},
		{"phosphorWoff2", readBase64(filepath.Join(rootDir, "fonts/phosphor/Phosphor-Light.woff2"), "font/woff2")},
		{"phosphorCss", readText(filepath.Join(rootDir, "fonts/phosphor/phosphor.css"))},
		{"iconoirWoff2", readBase64(filepath.Join(rootDir, "fonts/iconoir.woff2"), "font/woff2")},
		{"iconoirCss", readText(filepath.Join(rootDir, "fonts/iconoir-font.css"))},
		{"faviconB64", readBase64(filepath.Join(rootDir, "icons/icon-32.png"), "image/png")},
		{"annotatorJs", readText(filepath.Join(rootDir, "js/annotator.js"))},
		{"exportCss", readText(filepath.Join(rootDir, "css/export.css"))},
		{"navJs", readText(filepath.Join(rootDir, "js/export-nav.js"))},
	}

	var sb strings.Builder
	sb.WriteString("<script>\nwindow.SCREAM_ASSETS = {\n")
	for _, a := range assets {
		sb.WriteString("  ")
		sb.WriteString(a.key)
		sb.WriteString(": ")
		sb.WriteString(jsonStr(a.value))
		sb.WriteString(",\n")
	}
	sb.WriteString("};\n</script>")
	return sb.String()
}

// ── JS module bundler ─────────────────────────────────────────────────────────

var (
	reImport      = regexp.MustCompile(`(?s)import\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"];?`)
	reExportDecl  = regexp.MustCompile(`^(export\s+)((?:async\s+)?(?:function|const|let|var|class)\b)`)
	reExportBrace = regexp.MustCompile(`^export\s*\{[^}]*\}`)
	reExportDef   = regexp.MustCompile(`^export\s+default\b`)
)

type bundler struct {
	seen   map[string]bool
	chunks []string
}

func (b *bundler) walk(absPath string) {
	if b.seen[absPath] {
		return
	}
	b.seen[absPath] = true

	src := readText(absPath)
	dir := filepath.Dir(absPath)

	// Walk imports first (topological order); handles multiline import blocks.
	for _, m := range reImport.FindAllStringSubmatch(src, -1) {
		spec := m[1]
		if strings.HasPrefix(spec, ".") {
			resolved := filepath.Clean(filepath.Join(dir, spec))
			b.walk(resolved)
		}
	}

	// Strip all import blocks, then process line-by-line for export stripping.
	stripped := reImport.ReplaceAllString(src, "")

	var out []string
	for _, raw := range strings.Split(stripped, "\n") {
		line := strings.TrimSpace(raw)

		if reExportBrace.MatchString(line) {
			continue
		}
		if reExportDef.MatchString(line) {
			continue
		}
		if reExportDecl.MatchString(line) {
			if idx := strings.Index(raw, "export "); idx >= 0 {
				raw = raw[:idx] + raw[idx+7:]
			}
		}
		out = append(out, raw)
	}

	b.chunks = append(b.chunks,
		fmt.Sprintf("// ── %s ──", filepath.Base(absPath)),
		strings.Join(out, "\n"),
	)
}

func buildIifeBundle(rootDir string) string {
	b := &bundler{seen: make(map[string]bool)}
	b.walk(filepath.Join(rootDir, "js/main.js"))

	var sb strings.Builder
	sb.WriteString("<script>\n(function() {\n'use strict';\n\n")
	for _, chunk := range b.chunks {
		sb.WriteString(chunk)
		sb.WriteString("\n\n")
	}
	sb.WriteString("})();\n</script>")

	// `</script>` inside the IIFE would make the HTML parser close the <script>
	// block prematurely. Replace with `<\/script>`: HTML won't match it as an end
	// tag, but JS evaluates `\/` as `/` so the string value is unchanged at runtime.
	iife := sb.String()
	iife = strings.ReplaceAll(iife, "</script>", `<\/script>`)
	// Restore our own intentional closing tag (the very last one).
	iife = iife[:len(iife)-len(`<\/script>`)] + "</script>"
	return iife
}

// ── Manifest embedding ────────────────────────────────────────────────────────

// embedManifest inlines manifest.json — with all icons base64-encoded — as a
// data URI on the <link rel="manifest"> tag. This keeps the single-file build
// installable as a PWA without a sibling manifest.json.
func embedManifest(html, rootDir string) string {
	manifestPath := filepath.Join(rootDir, "manifest.json")
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		return html
	}
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		panic(fmt.Sprintf("parse manifest.json: %v", err))
	}

	// Inline each icon's src as a base64 data URI.
	if icons, ok := m["icons"].([]interface{}); ok {
		for _, iconI := range icons {
			if icon, ok := iconI.(map[string]interface{}); ok {
				if src, ok := icon["src"].(string); ok && !strings.HasPrefix(src, "data:") {
					iconPath := filepath.Join(rootDir, src)
					if _, err := os.Stat(iconPath); err == nil {
						icon["src"] = readBase64(iconPath, "image/png")
					}
				}
			}
		}
	}
	m["start_url"] = "/"

	out, err := json.Marshal(m)
	if err != nil {
		panic(fmt.Sprintf("marshal manifest: %v", err))
	}
	dataURI := "data:application/manifest+json;base64," + base64.StdEncoding.EncodeToString(out)

	reManifest := regexp.MustCompile(`<link rel="manifest" href="[^"]*"[^>]*/?>`)
	return reManifest.ReplaceAllLiteralString(html, `<link rel="manifest" href="`+dataURI+`" />`)
}

// ── CSP hashing ───────────────────────────────────────────────────────────────

var (
	reScriptBlock = regexp.MustCompile(`(?s)<script(?:\s[^>]*)?>(.*?)</script>`)
	reStyleBlock  = regexp.MustCompile(`(?s)<style(?:\s[^>]*)?>(.*?)</style>`)
)

func cspHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
}

// injectCSP scans the assembled HTML for every inline <script> and <style>
// block, hashes each, and inserts a Content-Security-Policy <meta> tag.
func injectCSP(html string) string {
	var scriptHashes, styleHashes []string

	for _, m := range reScriptBlock.FindAllStringSubmatch(html, -1) {
		if strings.Contains(m[0][:len(m[0])-len(m[1])-len("</script>")], "src=") {
			continue
		}
		scriptHashes = append(scriptHashes, cspHash(m[1]))
	}
	for _, m := range reStyleBlock.FindAllStringSubmatch(html, -1) {
		styleHashes = append(styleHashes, cspHash(m[1]))
	}

	csp := "default-src 'self'; " +
		"script-src 'self' " + strings.Join(scriptHashes, " ") + "; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data:; font-src 'self' data:; " +
		"manifest-src 'self' data:; " +
		"connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

	metaTag := fmt.Sprintf(`  <meta http-equiv="Content-Security-Policy" content="%s" />`+"\n", csp)

	reCharset := regexp.MustCompile(`(<meta charset="UTF-8" />\n)`)
	if reCharset.MatchString(html) {
		return reCharset.ReplaceAllString(html, "${1}"+strings.ReplaceAll(metaTag, "$", "$$"))
	}
	return regexp.MustCompile(`(<head>\n)`).ReplaceAllString(html, "${1}"+strings.ReplaceAll(metaTag, "$", "$$"))
}

// ── HTML processing ───────────────────────────────────────────────────────────

func processHtml(src, rootDir string) string {
	// Embed manifest.json (icons inlined) as a data URI instead of stripping.
	src = embedManifest(src, rootDir)

	// Remove SW registration <script> block.
	src = regexp.MustCompile(`(?s)\s*<script>\s*if\s*\('serviceWorker'\s+in\s+navigator\).*?</script>`).
		ReplaceAllString(src, "")

	// Inline favicon as data URI (keeps the link tag, replaces href).
	reIcon := regexp.MustCompile(`<link rel="icon" href="([^"]+)"[^>]*/?>`)
	src = reIcon.ReplaceAllStringFunc(src, func(match string) string {
		m := reIcon.FindStringSubmatch(match)
		if m == nil {
			return match
		}
		dataURI := readBase64(filepath.Join(rootDir, m[1]), "image/png")
		return `<link rel="icon" href="` + dataURI + `" type="image/png" />`
	})

	// Inline img src attributes pointing to local files.
	reImg := regexp.MustCompile(`<img([^>]*) src="(\./[^"]+)"([^>]*)>`)
	src = reImg.ReplaceAllStringFunc(src, func(match string) string {
		m := reImg.FindStringSubmatch(match)
		if m == nil {
			return match
		}
		imgPath := filepath.Join(rootDir, m[2])
		mime := mimeForExt(filepath.Ext(m[2]))
		if mime == "" {
			return match
		}
		b, err := os.ReadFile(imgPath)
		if err != nil {
			return match
		}
		dataURI := "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(b)
		return "<img" + m[1] + ` src="` + dataURI + `"` + m[3] + ">"
	})

	// Inline CSS files, patching relative font URLs to base64 data URIs.
	reCSS := regexp.MustCompile(`<link rel="stylesheet" href="([^"]+)"[^>]*/?>`)
	src = reCSS.ReplaceAllStringFunc(src, func(match string) string {
		m := reCSS.FindStringSubmatch(match)
		if m == nil {
			return match
		}
		cssPath := filepath.Join(rootDir, m[1])
		css := readText(cssPath)
		css = patchCssFontUrls(css, filepath.Dir(cssPath))
		return "<style>\n" + css + "\n</style>"
	})

	// Inline plain (non-module) <script src="..."> tags.
	reScript := regexp.MustCompile(`<script src="([^"]+)"></script>`)
	src = reScript.ReplaceAllStringFunc(src, func(match string) string {
		m := reScript.FindStringSubmatch(match)
		if m == nil {
			return match
		}
		js := readText(filepath.Join(rootDir, m[1]))
		return "<script>\n" + js + "\n</script>"
	})

	// Replace the ES module entry point with SCREAM_ASSETS + IIFE bundle.
	reModule := regexp.MustCompile(`<script type="module" src="js/main\.js"></script>`)
	src = reModule.ReplaceAllLiteralString(src,
		buildScreamAssets(rootDir)+"\n    "+buildIifeBundle(rootDir))

	return src
}

// ── Entry point ───────────────────────────────────────────────────────────────

func main() {
	outFlag := flag.String("out", "dist/scream.html", "output file path")
	flag.Parse()

	rootDir, err := filepath.Abs(".")
	if err != nil {
		panic(err)
	}

	indexHtml := readText(filepath.Join(rootDir, "index.html"))
	result := processHtml(indexHtml, rootDir)
	reVersionDecl := regexp.MustCompile(`let VERSION = '__SCREAM_VERSION__';`)
	result = reVersionDecl.ReplaceAllLiteralString(result,
		"let VERSION = '"+readManifestVersion(rootDir)+"';")
	// Must run last: hashes are computed over the exact final script/style bytes.
	result = injectCSP(result)

	outPath, err := filepath.Abs(*outFlag)
	if err != nil {
		panic(err)
	}
	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		panic(err)
	}
	if err := os.WriteFile(outPath, []byte(result), 0o644); err != nil {
		panic(err)
	}
	fmt.Printf("✓ %s  (%d KB)\n", outPath, len(result)/1024)
}
