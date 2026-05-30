/**
 * Regression test for the ExtensionPreferences import path in prefs.js.
 *
 * In GNOME 50 the resource path for ExtensionPreferences moved from
 *   resource:///org/gnome/shell/extensions/prefs.js   (GNOME 45-48)
 * to
 *   resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js  (GNOME 50+)
 *
 * This test guards against accidental reversion to the old (broken) path.
 */

import {readFileSync} from 'fs';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';
import {describe, it, expect} from '@jest/globals';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prefsSource      = readFileSync(join(__dirname, '..', 'prefs.js'), 'utf8');
const extensionSource  = readFileSync(join(__dirname, '..', 'extension.js'), 'utf8');

const GNOME50_PREFS_PATH =
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
const OLD_PREFS_PATH =
    'resource:///org/gnome/shell/extensions/prefs.js';

describe('prefs.js ExtensionPreferences import', () => {
    it('uses the GNOME 50 resource path for ExtensionPreferences', () => {
        expect(prefsSource).toContain(GNOME50_PREFS_PATH);
    });

    it('does not use the obsolete GNOME 45-48 resource path', () => {
        // The old path does not exist in GNOME 50 and causes an ImportError.
        expect(prefsSource).not.toContain(OLD_PREFS_PATH);
    });
});

describe('prefs.js refreshMonitorRows safety', () => {
    it('does not use while(get_last_child()) to clear rows', () => {
        // Adw.PreferencesGroup always has internal libadwaita children so
        // that loop never terminates — it would hang the prefs window.
        expect(prefsSource).not.toContain('get_last_child()');
    });

    it('buildMonitorRows returns the added rows (return added pattern)', () => {
        // The function must return the rows it added so refreshMonitorRows
        // can remove exactly those rows without touching internal children.
        expect(prefsSource).toContain('return added');
    });
});

describe('prefs.js preset hiding', () => {
    it('defines buildPresetRows function', () => {
        expect(prefsSource).toContain('function buildPresetRows(');
    });

    it('filters presets by already-added names', () => {
        // The hide-added-preset logic matches monitors by name
        expect(prefsSource).toContain('addedNames.has(preset.name)');
    });
});

describe('prefs.js duplicate action', () => {
    it('adds a duplicate button to monitor rows', () => {
        expect(prefsSource).toContain('edit-copy-symbolic');
        expect(prefsSource).toContain('Duplicate');
    });

    it('inserts copy immediately after original (splice pattern)', () => {
        expect(prefsSource).toContain('all.splice(idx + 1, 0, copy)');
    });

    it('excludes original id from duplicate so a fresh id is generated', () => {
        // Spreading the original id caused both monitors to share the same id,
        // making delete remove both. The fix destructures id out before spreading.
        expect(prefsSource).toContain('id: _id');
    });

    it('appends Copy suffix to duplicated monitor name', () => {
        expect(prefsSource).toContain('name: `${monitor.name} Copy`');
    });
});

describe('extension.js startup grace period', () => {
    it('defines STARTUP_GRACE_MS constant', () => {
        expect(extensionSource).toContain('STARTUP_GRACE_MS');
    });

    it('passes STARTUP_GRACE_MS to _buildMenu on init', () => {
        expect(extensionSource).toContain('_buildMenu(STARTUP_GRACE_MS)');
    });

    it('_scheduleMonitor accepts firstRunDelay parameter', () => {
        expect(extensionSource).toContain('_scheduleMonitor(monitor, firstRunDelay');
    });

    it('_reloadMonitors calls _buildMenu without grace period', () => {
        // Settings-change reloads must run monitors immediately (no delay argument).
        expect(extensionSource).toContain('_buildMenu()');
    });
});

describe('extension.js panel icon alerting', () => {
    it('shows badge for CAUTION (not just ERROR)', () => {
        // Badge must be visible for caution/danger states so the panel icon
        // communicates alerting states even when colour alone is unreliable.
        expect(extensionSource).toContain('MonitorStatus.CAUTION');
        expect(extensionSource).toContain('alerting');
    });

    it('applies inline style colour to bypass panel theme specificity', () => {
        expect(extensionSource).toContain('_panelIcon.style');
        expect(extensionSource).toContain('STATUS_COLORS');
    });
});
