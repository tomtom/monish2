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
const schemaSource     = readFileSync(
    join(__dirname, '..', 'schemas', 'org.gnome.shell.extensions.monish.gschema.xml'), 'utf8',
);

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

describe('prefs.js manual sort', () => {
    it('adds move-up and move-down buttons to monitor rows', () => {
        expect(prefsSource).toContain('go-up-symbolic');
        expect(prefsSource).toContain('go-down-symbolic');
    });

    it('disables move-up on the first row', () => {
        expect(prefsSource).toContain('sensitive:    !isFirst');
    });

    it('disables move-down on the last row', () => {
        expect(prefsSource).toContain('sensitive:    !isLast');
    });

    it('swaps adjacent elements for move-up', () => {
        expect(prefsSource).toContain('[all[idx - 1], all[idx]] = [all[idx], all[idx - 1]]');
    });

    it('swaps adjacent elements for move-down', () => {
        expect(prefsSource).toContain('[all[idx], all[idx + 1]] = [all[idx + 1], all[idx]]');
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

describe('extension.js on-demand monitors', () => {
    it('skips scheduling for on-demand monitors', () => {
        expect(extensionSource).toContain('monitor.onDemand');
    });

    it('defines _expiryTimers map', () => {
        expect(extensionSource).toContain('_expiryTimers');
    });

    it('defines _resetOnDemandMonitor method', () => {
        expect(extensionSource).toContain('_resetOnDemandMonitor');
    });

    it('shows Update button label for on-demand monitors', () => {
        expect(extensionSource).toContain('\'Update\'');
    });
});

describe('extension.js multi-line output', () => {
    it('checks for newlines in value', () => {
        expect(extensionSource).toContain('value.includes(\'\\n\')');
    });

    it('defines mlValueLabel for below-name display', () => {
        expect(extensionSource).toContain('mlValueLabel');
    });
});

describe('extension.js jitter scheduling', () => {
    it('reads jitter-percent from settings', () => {
        expect(extensionSource).toContain('\'jitter-percent\'');
    });

    it('uses jitteredInterval for each poll', () => {
        expect(extensionSource).toContain('jitteredInterval');
    });
});

describe('prefs.js on-demand monitor UI', () => {
    it('adds On Demand toggle to edit dialog', () => {
        expect(prefsSource).toContain('On Demand');
    });

    it('adds Valid for seconds spinbutton', () => {
        expect(prefsSource).toContain('onDemandValidSeconds');
    });
});

describe('prefs.js jitter setting', () => {
    it('shows jitter spinner in prefs', () => {
        expect(prefsSource).toContain('jitter-percent');
    });
});

describe('prefs.js Add Monitor button position', () => {
    it('monitorsGroup.add(addRow) appears before buildMonitorRows so the button is always at the top', () => {
        const addIdx   = prefsSource.indexOf('monitorsGroup.add(addRow)');
        const buildIdx = prefsSource.indexOf('buildMonitorRows(monitorsGroup');
        expect(addIdx).toBeGreaterThan(-1);
        expect(buildIdx).toBeGreaterThan(-1);
        expect(addIdx).toBeLessThan(buildIdx);
    });
});

describe('GSettings schema defaults', () => {
    it('jitter-percent defaults to 5 so new installs get a sensible schedule spread', () => {
        // Guard against accidental reversion to 0 (exact timing / no jitter).
        expect(schemaSource).toContain('<default>5</default>');
    });

    it('splitInterval and toSeconds are imported from lib/monitor.js in prefs', () => {
        // Guards that the refactored interval helpers are imported from the
        // shared module, not redefined locally in prefs.js.
        expect(prefsSource).toContain('splitInterval');
        expect(prefsSource).toContain('toSeconds');
    });
});

describe('prefs.js interval UI (seconds-only) — ISSUE 27', () => {
    it('does not define INTERVAL_UNITS (unit dropdown removed)', () => {
        // Bug 27: the unit dropdown was showing intervals in minutes; all
        // interval input is now in seconds only.
        expect(prefsSource).not.toContain('INTERVAL_UNITS');
    });

    it('does not define unitDropDown (unit selector removed)', () => {
        expect(prefsSource).not.toContain('unitDropDown');
    });

    it('labels the interval field with (s) to indicate seconds', () => {
        expect(prefsSource).toContain('\'Interval (s)\'');
    });
});

describe('prefs.js interval spinner init — ISSUE 28', () => {
    it('interval spinner is initialised from data.intervalSeconds directly', () => {
        // Bug 28: using splitInterval magnitude (e.g. 1 for "1 minute") instead
        // of the raw intervalSeconds (60) caused preset intervals to show wrong
        // values and be silently overwritten on save.
        expect(prefsSource).not.toContain('value:       magnitude');
    });
});

describe('prefs.js jitter persistence — ISSUE 29', () => {
    it('jitter spinner sets its value explicitly after the change handler is connected', () => {
        // Bug 29: initialising the SpinButton with settings.get_int() in the
        // constructor can fire value-changed before the handler is registered,
        // losing the stored value.  The fix calls set_value() after connect().
        expect(prefsSource).toContain('jitterSpin.set_value(settings.get_int(\'jitter-percent\'))');
    });
});

describe('prefs.js interval spinner safe init — ISSUE 29 re-open', () => {
    it('interval spinner Adjustment starts at lower bound (1), not data.intervalSeconds', () => {
        // GJS GObject property init sets value before lower; if intervalSeconds
        // is 0 (old stored data) the Adjustment is left unclamped (value=0 with
        // lower=1).  Fix: start at 1 then call set_value() so GTK clamps correctly.
        expect(prefsSource).not.toContain('value:          data.intervalSeconds');
    });

    it('interval spinner calls set_value(data.intervalSeconds) after construction', () => {
        expect(prefsSource).toContain('intervalSpin.set_value(data.intervalSeconds)');
    });
});

describe('interval 0 = disabled — ISSUE 31', () => {
    it('interval Adjustment lower bound is 0 (allows disabled monitors)', () => {
        expect(prefsSource).toContain('lower:          0,');
    });

    it('edit dialog shows a hint that 0 disables the monitor', () => {
        expect(prefsSource).toContain('Set to 0 to disable this monitor.');
    });

    it('buildMonitorRows shows "disabled" subtitle for intervalSeconds === 0', () => {
        expect(prefsSource).toContain("intervalStr = 'disabled'"); // eslint-disable-line quotes
    });

    it('buildMonitorRows sets opacity to 0.5 for disabled or inactive monitors', () => {
        expect(prefsSource).toContain('row.opacity = 0.5');
    });

    it('extension skips monitors with intervalSeconds === 0', () => {
        expect(extensionSource).toContain('m.intervalSeconds !== 0');
    });
});

describe('debug logging — ISSUE 30', () => {
    it('schema defines a debug-logging boolean key', () => {
        expect(schemaSource).toContain('name="debug-logging" type="b"');
    });

    it('extension reads the debug-logging setting', () => {
        expect(extensionSource).toContain('debug-logging');
    });

    it('extension defines _appendDebugLog to write log entries', () => {
        expect(extensionSource).toContain('_appendDebugLog');
    });

    it('prefs shows a debug-logging toggle', () => {
        expect(prefsSource).toContain('debug-logging');
    });

    it('prefs opens a log viewer via showDebugLogWindow', () => {
        expect(prefsSource).toContain('showDebugLogWindow');
    });
});
