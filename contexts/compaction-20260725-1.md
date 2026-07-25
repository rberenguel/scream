# Session Compaction Summary

## User Intent
- Fix broken single-page mode (`dist/scream.html`) — present mode was completely non-functional
- Identify and fix the root causes systematically (with logging when guessing)
- Update PLAN.md to reflect completed sessions E and F

## Contextual Work Summary

### Bug 1 — Template literal interpolations silently erased (weave.go)
- `ReplaceAllString` in Go's regexp treats `${name}` in the replacement string as named capture group references, so every JS template literal like `${slidesHtml}`, `${overviewHtml}`, `${HELP_HTML}` was replaced with empty string in the generated IIFE
- Fix: changed to `ReplaceAllLiteralString` in `processHtml` where the IIFE bundle is substituted into the HTML
- This was the root cause of "empty slide wrappers" crash in `export-nav.js` (`showSlide` crashing because `wrappers` was empty)

### Bug 2 — BroadcastChannel cross-origin failure (present mode P key)
- The presenter window is opened as a `blob:null/...` URL; the editor window is at `file://` with a unique opaque origin; Chrome treats these as different origins, so BroadcastChannel messages never deliver
- Symptom: presenter window opened with correct layout but no slides; `presenter-ready` message never reached the audience
- Fix: replaced BroadcastChannel-only IPC with dual-transport in `export-nav.js`:
  - `sendToPresenter(msg)`: tries `presenterWin.postMessage(msg, '*')` first (cross-origin safe), falls back to `channel.postMessage`
  - `sendToAudience(msg)`: tries `window.opener.postMessage(msg, '*')` first, falls back to `channel.postMessage`
  - Both sides listen on both `channel.onmessage` and `window.addEventListener('message', …)`; only one fires per message since the helpers use one transport or the other, not both

### Debugging approach
- Used `go run` + grep to verify template interpolations in generated file
- Added targeted `console.log` to `export-nav.js` and `present.js` to confirm `_presentUrl` was set correctly and `window.open` was using the blob URL (not the file URL)
- Logs confirmed blob URL was correct; `presenter-ready` logs never appeared → confirmed BroadcastChannel as the failure point

### PLAN.md update
- Sessions E and F marked ✅ done
- Added "Sessions E+F" section documenting all three bugs fixed (template literal erasure, `</script>` escaping from prior session, BroadcastChannel cross-origin)
- Session G (SW cache update, version bump) remains

## Files Touched

### Build
- **weave.go**: `ReplaceAllString` → `ReplaceAllLiteralString` for IIFE injection; this was the only change needed

### Core JS
- **js/export-nav.js**: Full IPC overhaul — `sendToPresenter` / `sendToAudience` helpers replacing direct `channel.postMessage` calls everywhere; both sides listen on dual transports; removed debug logging added mid-session
- **js/present.js**: Removed temporary debug `console.log` for `_presentUrl`

### Docs
- **PLAN.md**: Sessions E + F marked done; new section documenting all bugs and fixes from those sessions

## Next Steps
- Session G: update `sw.js` cache list, bump version in `manifest.json` and `sw.js`, end-to-end test of PWA
- Consider whether `dist/` should be added to `.gitignore` (noted as a decision in PLAN.md but may not have been actioned)
