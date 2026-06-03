# GNOME Shell Extension Review Guidelines — Summary & monish2 Compliance

Sources:
- https://gjs.guide/extensions/review-guidelines/review-guidelines.html
- https://gjs.guide/extensions/

---

## Key Guidelines

### Lifecycle

- Create objects, connect signals, add GLib sources only in `enable()`.
- `disable()` must clean up **everything**: objects, signals, timers.
- All signals must be explicitly disconnected.
- All GLib sources must be removed even if their callbacks return `SOURCE_REMOVE`.
- Static data structures at module scope are fine; no object instantiation.

### Code Quality

- Readable, unobfuscated; no minification.
- ES6+; consistent indentation.
- ESLint recommended and covers all extension files.
- No excessive `log()` / `console.log()` output in production paths.
- No `force_dispose()` without explanatory comment.
- No imaginary APIs; extension must actually work.
- Dynamic code execution (`eval`, `new Function`) in the Shell process requires justification.

### Library Restrictions

| Context | Forbidden |
|---------|-----------|
| `extension.js` | `Gdk`, `Gtk`, `Adw` (GTK libraries) |
| `prefs.js` | `Clutter`, `Meta`, `St`, `Shell` (Shell libraries) |
| Everywhere | `ByteArray`, `Lang`, `Mainloop` (deprecated) |

Replacements: `TextDecoder`/`TextEncoder`, ES6 classes, `GLib.timeout_add`.

### External Processes / Security

- No binary executables in the package.
- External scripts: GJS preferred; must be OSI-licensed.
- Privileged subprocesses need `pkexec`; must not be user-writable.
- No telemetry, analytics, or user tracking.
- Clipboard usage must be declared in description.

### Metadata (`metadata.json`)

- `uuid`: `name@namespace`, alphanumeric + `.`/`_`/`-`. **Never `gnome.org` as namespace.**
- `name`: unique, no conflicts with existing extensions.
- `description`: accurate and reasonable.
- `shell-version`: stable releases + at most one dev version.
- `url`: valid repository URL.
- `session-modes`: required when using non-default session modes; explicit `["user"]` recommended.
- `donations`: recommended for disclosure.

### Licensing

- Must be **GPL-2.0-or-later** or compatible (GPL-3.0 qualifies).
- `COPYING` or `LICENSE` file required in the package.
- SPDX identifiers in source headers are good practice.
- Borrowed code requires attribution.

---

## monish2 Compliance Analysis

### ✅ Compliant

| Area | Details |
|------|---------|
| Lifecycle — `enable()`/`disable()` | `enable()` creates indicator; `disable()` calls `destroy()` which disconnects signals, stops all timers, destroys widgets. |
| Signal cleanup | `_settingsChangedId` and `_jitterChangedId` explicitly disconnected in `destroy()`. Widget-owned signals released via `super.destroy()`. |
| GLib source cleanup | `_stopAllTimers()` iterates and removes all entries in `_timers` and `_ageTimers`. |
| Library restrictions — extension.js | No `Gtk`/`Gdk`/`Adw` imports. |
| Library restrictions — prefs.js | No `Clutter`/`Meta`/`St`/`Shell` imports. |
| No deprecated modules | No `ByteArray`, `Lang`, `Mainloop` anywhere. |
| Code readability | Well-formatted, 4-space indent, thorough JSDoc. |
| ESLint present | `.eslintrc.json` exists; `make lint` runs eslint. |
| No binaries in package | Zip contains only `.js`, `.json`, `.xml`, `.css`, `.svg`. |
| No telemetry | No network calls or tracking. |
| UUID format | `monish2@thm.link` — valid format, non-gnome.org namespace. |
| `shell-version` | Lists stable + near-future versions. |
| No clipboard use | Not present. |
| Code is functional | Comprehensive unit test suite; no imaginary APIs. |

---

### ⚠️ Issues Found

#### CRITICAL — Will block EGO submission

**1. No license file in the zip**
- `README.md` mentions GPL-3.0 but is not included in the zip.
- No `COPYING`/`LICENSE` file in the package.
- No SPDX headers in source files.
- **Fix:** Add `COPYING` with GPL-3.0 text; update `Makefile` zip target to include it. Or add `// SPDX-License-Identifier: GPL-3.0-or-later` to each `.js` file.

---

#### MODERATE — Likely to draw reviewer comments

**2. `new Function()` in the Shell process (`extension.js`)**
- Used to evaluate user-supplied action guard expressions.
- Reviewers may flag dynamic code execution in the Shell process.
- **Fix:** Add a clear comment explaining this evaluates the user's own configuration (not remote data) and is wrapped in try/catch. Alternatively, implement a simple safe expression parser for the common cases.

**3. Conditional `log()` in the Shell process**
- `log()` calls in `extension.js` are gated by a debug-logging GSettings boolean (default `false`).
- Reviewers can be strict about any `log()` in the Shell process.
- **Fix:** Document clearly in the EGO submission that these are behind a user setting. Consider switching to `console.debug()`.

**4. Debug log written to extension install directory**
- `debug.log` is written to `~/.local/share/gnome-shell/extensions/monish2@thm.link/`.
- Unusual pattern; standard is `GLib.get_user_cache_dir()` or `GLib.get_user_data_dir()`.
- **Fix:** Redirect to `~/.cache/monish2/debug.log` or `~/.local/share/monish2/debug.log`.

---

#### MINOR — Quality/recommendation items

**5. `session-modes` missing from `metadata.json`**
- Absence is acceptable for default-session-only extensions but the EGO validator may warn.
- **Fix:** Add `"session-modes": ["user"]`.

**6. ESLint does not cover `extension.js` / `prefs.js`**
- `npm run lint` only lints `lib/` and `test/`.
- **Fix:** Add `extension.js` and `prefs.js` to the lint script. Note: current config sets `"env": {"node": true}`; GJS gi:// imports need a GNOME ESLint plugin or `globals` overrides to avoid false positives.

**7. `gettext-domain` set but unused**
- `metadata.json` declares `"gettext-domain": "monish2@thm.link"` but no `gettext()` calls or `.po` files exist.
- **Fix:** Remove the key, or add a placeholder `po/` directory if translations are planned.

---

## Priority Summary

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 1 | No COPYING/LICENSE in zip | **Critical** | Low |
| 2 | `new Function()` in Shell process | Moderate | Low–Medium |
| 3 | `log()` in Shell process (gated) | Moderate | Low |
| 4 | Debug log in extension install dir | Moderate | Low |
| 5 | `session-modes` missing | Minor | Trivial |
| 6 | ESLint missing extension.js/prefs.js | Minor | Low |
| 7 | `gettext-domain` set but unused | Minor | Trivial |
