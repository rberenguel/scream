package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var (
	// For HTML: finds href="..." and src="..." attributes.
	htmlRegex = regexp.MustCompile(`(?:href|src)="([^"]+)"`)
	// For JS: finds relative imports (with or without .js extension).
	// Only relative paths (starting with . or ..) are captured; node_modules-style
	// bare specifiers are excluded by the leading-dot requirement.
	jsRegex = regexp.MustCompile(`(?:import|export)(?:\s+.*?from)?\s+['"](\.[^"']+)['"]`)
	// For CSS: finds url(...) declarations for common font types.
	cssRegex = regexp.MustCompile(`url\(['"]?([^'")]+(\.(?:woff|woff2|ttf|otf|eot|svg)))['"]?\)`)
	// For manifest.json: finds "src": "..." and "start_url": "..."
	jsonRegex = regexp.MustCompile(`"(?:start_url|src)":\s*"([^"]+)"`)
)

func main() {
	rootFile := "index.html"
	if _, err := os.Stat(rootFile); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Error: %s not found. Please run in your project's root directory.\n", rootFile)
		os.Exit(1)
	}

	queue := []string{rootFile}
	discovered := map[string]bool{rootFile: true}

	// Also seed from every immediate subdirectory that has an index.html,
	// so the root service worker can cache all sub-apps from a single crawl.
	entries, _ := os.ReadDir(".")
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		candidate := filepath.Join(e.Name(), "index.html")
		if _, err := os.Stat(candidate); err == nil {
			if !discovered[candidate] {
				discovered[candidate] = true
				queue = append(queue, candidate)
			}
		}
	}

	for len(queue) > 0 {
		currentFile := queue[0]
		queue = queue[1:]

		content, err := ioutil.ReadFile(currentFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: could not read file %s, skipping.\n", currentFile)
			continue
		}

		baseDir := filepath.Dir(currentFile)
		fileExt := filepath.Ext(currentFile)

		var re *regexp.Regexp
		switch fileExt {
		case ".html":
			re = htmlRegex
		case ".js":
			re = jsRegex
		case ".css":
			re = cssRegex
		case ".json":
			re = jsonRegex
		default:
			continue // Skip other file types
		}
		findDependencies(string(content), baseDir, re, &queue, discovered)
	}

	printCacheList(discovered)
}

func findDependencies(content, baseDir string, re *regexp.Regexp, queue *[]string, discovered map[string]bool) {
	matches := re.FindAllStringSubmatch(content, -1)
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		depPath := match[1]

		if strings.HasPrefix(depPath, "http") || strings.HasPrefix(depPath, "data:") {
			continue
		}

		addPath := func(p string) bool {
			if _, exists := discovered[p]; exists {
				return false
			}
			if info, err := os.Stat(p); err == nil && !info.IsDir() {
				discovered[p] = true
				*queue = append(*queue, p)
				return true
			}
			return false
		}

		cleanPath := filepath.Clean(filepath.Join(baseDir, depPath))
		if !addPath(cleanPath) && !strings.HasSuffix(depPath, ".js") {
			// Bare import (no .js extension): try path.js and path/index.js
			addPath(cleanPath + ".js")
			addPath(filepath.Join(cleanPath, "index.js"))
		}
	}
}

func printCacheList(fileSet map[string]bool) {
	var fileList []string
	for file := range fileSet {
		fileList = append(fileList, file)
	}
	sort.Strings(fileList)

	fmt.Println("const CACHE_FILES = [")
	for _, file := range fileList {
		// Use forward slashes for web compatibility
		fmt.Printf("  './%s',\n", filepath.ToSlash(file))
	}
	fmt.Println("];")
}