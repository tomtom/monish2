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

import {readFileSync, existsSync, readdirSync} from 'fs';
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

    it('does not use _expiryTimers (on-demand values no longer auto-expire — ISSUE 96)', () => {
        expect(extensionSource).not.toContain('_expiryTimers');
    });

    it('does not define _resetOnDemandMonitor (values persist until next update — ISSUE 96)', () => {
        expect(extensionSource).not.toContain('_resetOnDemandMonitor');
    });

    it('disables sparklines for on-demand monitors — ISSUE 96', () => {
        // Sparklines are meaningless for on-demand monitors (single data point per click).
        expect(extensionSource).toContain('monitor?.onDemand');
        expect(extensionSource).toContain('showSpark');
    });

    it('adds on-demand CSS class to nameLabel so the name is always underlined — ISSUE 113', () => {
        // On-demand monitors show a permanent underline so users know the name is clickable.
        expect(extensionSource).toContain('monitor-name-on-demand');
        expect(extensionSource).toContain('monitor.onDemand');
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

describe('prefs.js on-demand monitor UI — ISSUE 45 / ISSUE 96', () => {
    it('does not add an On Demand toggle (removed; 0s interval is the signal)', () => {
        // The explicit On Demand switch was replaced by setting interval=0.
        expect(prefsSource).not.toContain('labeledRow(\'On Demand\'');
    });

    it('interval hint documents 0 as on-demand', () => {
        expect(prefsSource).toContain('on-demand');
    });

    it('does not have Valid for seconds spinbutton (removed — ISSUE 96)', () => {
        // On-demand values now persist until the next update; no expiry timer.
        expect(prefsSource).not.toContain('onDemandValidSeconds');
    });

    it('does not have validForRow visibility logic (field removed — ISSUE 96)', () => {
        expect(prefsSource).not.toContain('intervalSpin.get_value_as_int() === 0');
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
        // Guards that interval helpers are imported from the shared module.
        // toSeconds restored with the interval spinner (ISSUE 112).
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

    it('interval label is Interval (s) — ISSUE 112 restored spinner, removed Interval Expr (ISSUE 108)', () => {
        // ISSUE 112: Interval Expr field removed; Interval (s) spinner is the sole interval input.
        expect(prefsSource).toContain('\'Interval (s)\'');
        expect(prefsSource).not.toContain('\'Interval Expr\'');
    });
});

describe('prefs.js interval spinner init — ISSUE 28', () => {
    it('interval spinner is initialised from data.intervalSeconds directly', () => {
        // Bug 28: using splitInterval magnitude (e.g. 1 for "1 minute") instead
        // of the raw intervalSeconds (60) caused preset intervals to show wrong
        // values and be silently overwritten on save.
        expect(prefsSource).not.toContain('value:       magnitude');
        // ISSUE 112: spinner restored; confirm it is seeded from data.intervalSeconds.
        expect(prefsSource).toContain('intervalSpin');
        expect(prefsSource).toContain('data.intervalSeconds');
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

describe('prefs.js interval spinner restored — ISSUE 112', () => {
    it('intervalSpin widget present in edit dialog (Interval Expr removed)', () => {
        // ISSUE 112: Interval (s) spinner restored; expression field removed.
        expect(prefsSource).toContain('intervalSpin');
        expect(prefsSource).not.toContain('intervalExpression:   exprText');
    });

    it('save handler clears intervalExpression to empty string', () => {
        // Saving via spinner always resets any stored expression so old AI-agent
        // monitors no longer carry a stale expression after editing.
        expect(prefsSource).toContain("intervalExpression: ''");
    });
});

describe('interval 0 = on-demand — ISSUE 31 / ISSUE 45', () => {
    it('edit dialog expression hint explains 0 means on-demand — ISSUE 108', () => {
        // ISSUE 108: Interval (s) spinner removed; expression field is the sole
        // interval input.  Hint must explain that 0 means on-demand.
        expect(prefsSource).toContain('on-demand');
    });

    it('buildMonitorRows shows "on-demand" subtitle for intervalSeconds === 0', () => {
        expect(prefsSource).toContain("intervalStr = 'on-demand'"); // eslint-disable-line quotes
    });

    it('buildMonitorRows sets opacity to 0.5 for disabled (not-enabled) monitors only', () => {
        // Opacity must depend solely on enabled flag; interval=0 is on-demand, not disabled.
        expect(prefsSource).toContain('!monitor.enabled');
        expect(prefsSource).toContain('row.opacity = 0.5');
    });

    it('extension includes interval=0 monitors in the menu (on-demand, not skipped)', () => {
        // interval=0 is on-demand: monitor is shown in menu but not scheduled.
        // Derived onDemand flag normalised in _buildMenu.
        expect(extensionSource).toContain('m.intervalSeconds === 0');
    });
});

describe('extension.js per-app sparklines — ISSUE 46', () => {
    it('defines _appHistory for per-app value ring buffers', () => {
        expect(extensionSource).toContain('_appHistory');
    });

    it('clears _appHistory on menu rebuild', () => {
        expect(extensionSource).toContain('_appHistory.clear()');
    });

    it('builds per-app sparkline for each line of multi-line output', () => {
        expect(extensionSource).toContain('_appHistory.get(id)');
    });
});

describe('extension.js right-aligned sparklines — ISSUE 47', () => {
    it('defines sparklineLabel as a separate widget', () => {
        expect(extensionSource).toContain('sparklineLabel');
    });

    it('nameLabel has x_expand so sparklineLabel is pushed to the right edge', () => {
        expect(extensionSource).toContain('x_expand:    true');
    });

    it('sparklineLabel is tracked in _menuItems entry', () => {
        expect(extensionSource).toContain('sparklineLabel');
    });

    it('_setMonitorResult sets sparklineLabel.text separately from value label', () => {
        expect(extensionSource).toContain('entry.sparklineLabel.text');
    });
});

describe('extension.js sparkline — ISSUE 35', () => {
    it('imports buildSparkline and extractNumber from lib/monitor.js', () => {
        expect(extensionSource).toContain('buildSparkline');
        expect(extensionSource).toContain('extractNumber');
    });

    it('defines _history map for ring-buffer storage', () => {
        expect(extensionSource).toContain('_history');
    });

    it('clears _history on menu rebuild', () => {
        expect(extensionSource).toContain('_history.clear()');
    });

    it('skips adding error-status values to history', () => {
        // Error strings (e.g. "exit code 1") must not pollute the ring buffer.
        expect(extensionSource).toContain('MonitorStatus.ERROR');
        expect(extensionSource).toContain('extractNumber');
    });

    it('computes sparkline and displays it (now via dedicated sparklineLabel — ISSUE 47)', () => {
        expect(extensionSource).toContain('sparkline');
        expect(extensionSource).toContain('sparklineLabel');
    });
});

describe('extension.js name-click update — ISSUE 34', () => {
    it('defines _triggerMonitor method', () => {
        expect(extensionSource).toContain('_triggerMonitor');
    });

    it('defines _scheduleNextRun method (timer reset after name-click)', () => {
        expect(extensionSource).toContain('_scheduleNextRun');
    });

    it('name label is an St.Button so it receives clicks', () => {
        // St.Button handles cursor change, hover, and clicked signal natively.
        expect(extensionSource).toContain('new St.Button(');
        expect(extensionSource).toContain('monitor-name');
    });

    it('name click connects to _triggerMonitor', () => {
        expect(extensionSource).toContain('_triggerMonitor(monitor)');
    });

    it('_triggerMonitor cancels existing timer before running', () => {
        // Timer must be cancelled so the next scheduled poll resets from now.
        expect(extensionSource).toContain('this._timers.get(monitor.id)');
        expect(extensionSource).toContain('GLib.source_remove(existingId)');
    });

    it('_triggerMonitor shows loading indicator while command runs', () => {
        expect(extensionSource).toContain('\'…\'');
    });

    it('_triggerMonitor calls _scheduleNextRun for non-on-demand monitors', () => {
        expect(extensionSource).toContain('this._scheduleNextRun(monitor)');
    });

    it('does not contain the removed Update button', () => {
        // The Update button was replaced by the clickable name label (ISSUE 34).
        expect(extensionSource).not.toContain('update-btn');
    });
});

describe('extension.js debug log format — ISSUE 40', () => {
    it('debug log uses tab separator, not pipe', () => {
        // TSV format: each field separated by \t so the file is directly parseable.
        expect(extensionSource).toContain('\\t${monitor.name}\\t${monitor.type}\\t');
        expect(extensionSource).not.toContain('| ${monitor.name} |');
    });
});

describe('extension.js multiline icon alignment — ISSUE 39', () => {
    it('statusIcon has y_align START so it stays at the top for multiline values', () => {
        expect(extensionSource).toContain('Clutter.ActorAlign.START');
    });
});

describe('argument injection — ISSUE 36', () => {
    it('extension imports injectArgs', () => {
        expect(extensionSource).toContain('injectArgs');
    });

    it('extension calls injectArgs before executing', () => {
        expect(extensionSource).toContain('injectArgs(');
    });

    it('prefs edit dialog has Add Argument button', () => {
        expect(prefsSource).toContain('Add Argument');
    });

    it('prefs edit dialog builds arg rows', () => {
        expect(prefsSource).toContain('buildArgRow');
        expect(prefsSource).toContain('rebuildArgRows');
    });

    it('prefs updates arg tooltips when type changes', () => {
        expect(prefsSource).toContain('currentArgTooltip');
    });

    it('prefs deep-copies args and argValues on dialog open', () => {
        // Prevents edits from mutating the original monitor object on cancel.
        expect(prefsSource).toContain('[...(monitor.args');
        expect(prefsSource).toContain('{...(monitor.argValues');
    });
});

describe('prefs.js move up/down scroll preservation — ISSUE 44', () => {
    it('sets _monitorId on each built row for post-rebuild focus lookup', () => {
        expect(prefsSource).toContain('row._monitorId = monitor.id');
    });

    it('up/down refresh passes monitor.id so the moved row is focused after rebuild', () => {
        expect(prefsSource).toContain('refresh(monitor.id)');
    });

    it('refreshMonitorRows calls grab_focus() on the target row after rebuild', () => {
        expect(prefsSource).toContain('grab_focus()');
    });
});

describe('prefs.js scroll position preservation after up/down — ISSUE 59', () => {
    it('defines findScrolledWindow helper to locate the page scroll container', () => {
        // Needed to get the Gtk.Adjustment before the row rebuild resets scroll.
        expect(prefsSource).toContain('findScrolledWindow');
    });

    it('refreshMonitorRows saves scroll position before rebuild', () => {
        expect(prefsSource).toContain('get_vadjustment().get_value()');
    });

    it('refreshMonitorRows restores scroll position via GLib.idle_add after grab_focus', () => {
        // grab_focus() scrolls to show the focused row; idle_add runs after that
        // scroll and overrides it, keeping the view at the pre-move position.
        expect(prefsSource).toContain('GLib.idle_add');
    });

    it('scroll restoration sets the adjustment back to the saved value', () => {
        expect(prefsSource).toContain('get_vadjustment().set_value(scrollPos)');
    });

    it('edit callback passes monitor.id and scrollToFocused=true — ISSUE 111', () => {
        // After saving an edit, the list must show the edited row, not reset to top.
        expect(prefsSource).toContain('refresh(monitor.id, true)');
    });

    it('refreshMonitorRows accepts scrollToFocused parameter — ISSUE 111', () => {
        // scrollToFocused=true skips scroll restoration so grab_focus() keeps the row visible.
        expect(prefsSource).toContain('scrollToFocused');
    });
});

describe('prefs.js Gnome RDP edit fix — ISSUE 114', () => {
    it('deep-copies action objects to prevent shared mutation on cancel', () => {
        // Shallow array copy leaves action objects shared between the dialog data
        // and the original monitor, so guard/label changes persist after Cancel.
        expect(prefsSource).toContain('(monitor.actions ?? []).map(a => ({...a}))');
    });

    it('dialog content is in a ScrolledWindow so error label is always visible', () => {
        // For monitors with many actions (e.g. Gnome RDP with 2 actions + guards)
        // the dialog content can exceed screen height, making the error label
        // at the bottom invisible.  max_content_height caps the dialog and enables scroll.
        expect(prefsSource).toContain('propagate_natural_height');
        expect(prefsSource).toContain('max_content_height');
    });

    it('buildMonitorRows refresh lambda passes scrollToFocused — ISSUE 111 fix', () => {
        // Original lambda fId => refreshAll(fId) discarded scrollToFocused=true
        // passed from the edit callback, so edited rows were never scrolled into view.
        expect(prefsSource).toContain('(fId, scrollToFocused) => refreshAll(fId, scrollToFocused)');
    });

    it('edit button handler catches exceptions and displays error in row subtitle', () => {
        // Errors from showMonitorEditDialog or onSave are caught and shown in
        // the monitor row subtitle in Prefs, below the monitor entry.
        expect(prefsSource).toContain('row.subtitle = `⚠ ${String(e.message ?? e)}`');
        expect(prefsSource).toContain('normalSubtitle');
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

    it('debug code is wrapped in DEBUG_ONLY_BEGIN/END markers for zip stripping — ISSUE 102', () => {
        // The Makefile zip target strips everything between these markers so the
        // distribution build contains no log() calls or debug infrastructure.
        expect(extensionSource).toContain('/* DEBUG_ONLY_BEGIN */');
        expect(extensionSource).toContain('/* DEBUG_ONLY_END */');
    });

    it('DEBUG_LOG_KEY constant is inside a debug marker block — ISSUE 102', () => {
        // If stripped, the constant must be absent so there are no reference errors.
        const beginIdx = extensionSource.indexOf('/* DEBUG_ONLY_BEGIN */');
        const endIdx   = extensionSource.indexOf('/* DEBUG_ONLY_END */');
        const keyIdx   = extensionSource.indexOf('DEBUG_LOG_KEY =');
        expect(keyIdx).toBeGreaterThan(beginIdx);
        expect(keyIdx).toBeLessThan(endIdx);
    });
});

describe('action commands — ISSUE 50', () => {
    it('prefs edit dialog has an Actions section', () => {
        expect(prefsSource).toContain('\'Actions\'');
    });

    it('prefs deep-copies action objects on dialog open — ISSUE 114', () => {
        // Spreading each action object (not just the array) prevents shared mutation:
        // changed-event handlers in buildActionRow won't touch the original monitor.
        expect(prefsSource).toContain('(monitor.actions ?? []).map(a => ({...a}))');
    });

    it('prefs save handler includes actions from data', () => {
        expect(prefsSource).toContain('actions:');
        expect(prefsSource).toContain('data.actions');
    });

    it('extension defines _runAction method', () => {
        expect(extensionSource).toContain('_runAction');
    });

    it('extension adds actionsBox to menu item when monitor has actions', () => {
        expect(extensionSource).toContain('actionsBox');
    });

    it('extension tracks actionsBox in _menuItems entry', () => {
        expect(extensionSource).toContain('actionsBox');
    });
});

describe('prefs.js help dialog for setup instructions — ISSUE 68', () => {
    it('defines showHelpDialog function', () => {
        expect(prefsSource).toContain('showHelpDialog');
    });

    it('edit dialog shows a help link when data.helpText is set', () => {
        expect(prefsSource).toContain('data.helpText');
    });

    it('help link uses activate-link signal to intercept the click', () => {
        expect(prefsSource).toContain('activate-link');
    });
});

describe('prefs.js help dialog transient parent — ISSUE 75', () => {
    it('showHelpDialog is called with the edit dialog (not the prefs window) as parent', () => {
        // When the edit dialog is modal, passing the prefs window as transient_for
        // hides the help dialog behind the modal. Fix: pass `dialog` instead.
        expect(prefsSource).toContain('showHelpDialog(dialog,');
    });
});

describe('prefs.js description field — ISSUE 66', () => {
    it('edit dialog has a Description labeled row', () => {
        expect(prefsSource).toContain('labeledRow(\'Description\'');
    });

    it('edit dialog initialises description from data.description', () => {
        expect(prefsSource).toContain('data.description');
    });

    it('save handler includes description in updated object', () => {
        expect(prefsSource).toContain('description:');
        expect(prefsSource).toContain('descEntry.get_text()');
    });

    it('buildMonitorRows subtitle includes monitor.description when present', () => {
        expect(prefsSource).toContain('monitor.description');
    });
});

describe('prefs.js monitor export/import — ISSUE 65', () => {
    it('defines showExportDialog function', () => {
        expect(prefsSource).toContain('showExportDialog');
    });

    it('defines showImportDialog function', () => {
        expect(prefsSource).toContain('showImportDialog');
    });

    it('export serialises monitors as pretty-printed JSON', () => {
        expect(prefsSource).toContain('JSON.stringify');
        expect(prefsSource).toContain('null, 2');
    });

    it('export uses Gtk.FileDialog.save to pick destination', () => {
        expect(prefsSource).toContain('FileDialog');
        expect(prefsSource).toContain('.save(');
    });

    it('import uses Gtk.FileDialog.open to pick source file', () => {
        expect(prefsSource).toContain('.open(');
    });

    it('import assigns fresh IDs so imported monitors never collide', () => {
        // createMonitor({...m}) gives each imported monitor a new generateId().
        expect(prefsSource).toMatch(/createMonitor\(\{\.\.\.m\b/);
    });

    it('import asks append vs replace via a dialog', () => {
        expect(prefsSource).toContain('Append');
        expect(prefsSource).toContain('Replace All');
    });

    it('prefs page has Export and Import button rows', () => {
        expect(prefsSource).toContain('Export Monitors');
        expect(prefsSource).toContain('Import Monitors');
    });
});

describe('action button guard — ISSUE 64', () => {
    it('prefs buildActionRow includes a guard entry for JS condition', () => {
        expect(prefsSource).toContain('action.guard');
    });

    it('prefs guard entry has a meaningful placeholder', () => {
        expect(prefsSource).toContain('JS condition');
    });

    it('extension stores actionBtns in _menuItems for per-button visibility control', () => {
        expect(extensionSource).toContain('actionBtns');
    });

    it('extension evaluates guard expression with current value in _setMonitorResult', () => {
        expect(extensionSource).toContain('action.guard');
    });

    it('extension uses evaluateGuard() instead of new Function — ISSUE 101', () => {
        // new Function() replaced by evaluateGuard() from lib/monitor.js to avoid
        // dynamic code execution in the Shell process (GNOME extension guidelines).
        expect(extensionSource).toContain('evaluateGuard');
        expect(extensionSource).not.toContain('new Function');
    });

    it('Gnome RDP Enable action has guard so it only shows when disabled', () => {
        // Import checked via presets.test.js; here we verify the source contains the pattern.
        // The preset guard expression matches the monitor value.
        expect(extensionSource).toContain('action.guard');
    });
});

describe('extension.js tooltip position above menu — ISSUE 69 / ISSUE 92', () => {
    it('does not use the broken py+12 positioning that placed tooltip below the menu', () => {
        // Custom floating tooltip removed in ISSUE 92; native tooltip_text used instead.
        expect(extensionSource).not.toContain('py + 12');
    });

    it('does not define _showTooltip (custom tooltip removed)', () => {
        expect(extensionSource).not.toContain('_showTooltip');
    });
});

describe('extension.js action monitors use icon colour — ISSUE 81', () => {
    it('does not use view-more-symbolic (three-dots) for action monitors', () => {
        expect(extensionSource).not.toContain('view-more-symbolic');
    });

    it('does not define ACTION_STATUS_ICONS', () => {
        expect(extensionSource).not.toContain('ACTION_STATUS_ICONS');
    });

    it('does not use actualStatusIcon (single icon suffices)', () => {
        expect(extensionSource).not.toContain('actualStatusIcon');
    });

    it('defines BASE_ICONS for plain vs action monitors', () => {
        // ISSUE 81: dot for plain monitors, hamburger for action monitors.
        expect(extensionSource).toContain('BASE_ICONS');
    });

    it('uses BinLayout container as click target for action monitors', () => {
        // BinLayout widget gives a reliable click area without an overlay badge.
        expect(extensionSource).toContain('BinLayout');
    });

    it('does not define STATUS_OVERLAY_ICONS (overlay approach removed)', () => {
        // ISSUE 81: status is shown via icon colour, not an overlay badge.
        expect(extensionSource).not.toContain('STATUS_OVERLAY_ICONS');
    });

    it('applies STATUS_COLORS inline style directly to statusIcon', () => {
        // Inline style bypasses panel theme specificity, same pattern as panel icon.
        expect(extensionSource).toContain('entry.statusIcon.style');
        expect(extensionSource).toContain('STATUS_COLORS[status]');
    });
});

describe('prefs.js per-monitor sparkline toggle — ISSUE 54', () => {
    it('edit dialog includes a showSparkline toggle switch', () => {
        expect(prefsSource).toContain('showSparkline');
    });

    it('edit dialog shows the sparkline toggle labeled "Show Sparkline"', () => {
        expect(prefsSource).toContain('Show Sparkline');
    });

    it('extension reads showSparkline from monitor config to decide whether to display it', () => {
        expect(extensionSource).toContain('showSparkline');
    });
});

describe('extension.js right-aligned per-app sparklines — ISSUE 53', () => {
    it('defines mlBox container for per-line rows in multi-line monitors', () => {
        // mlValueLabel with inline sparkline text is left-aligned; mlBox with
        // per-line HBox rows (lineText x_expand + lineSpark) right-aligns them.
        expect(extensionSource).toContain('mlBox');
    });

    it('each per-line row uses a lineText label with x_expand to push sparkline right', () => {
        expect(extensionSource).toContain('lineText');
    });

    it('entry includes mlBox so _setMonitorResult can populate per-line rows', () => {
        expect(extensionSource).toContain('entry.mlBox');
    });

    it('mlBox children are cleared and rebuilt on each multi-line update', () => {
        expect(extensionSource).toContain('mlBox.get_first_child()');
    });
});

describe('extension.js multi-line value right-aligned — ISSUE 76', () => {
    it('each per-line row adds a separate lineVal label for the value part', () => {
        // Previously the full "name value" string was one label; now name and value
        // are split so the value can be right-aligned with the monish-monitor-value style.
        expect(extensionSource).toContain('lineVal');
    });

    it('lineVal uses monish-monitor-value CSS class to match single-line value alignment', () => {
        expect(extensionSource).toContain('monitor-value');
        expect(extensionSource).toContain('lineVal');
    });

    it('perLines returns appName and appVal separately (not combined text)', () => {
        // Previously returned {text: line.trim(), spark}; now {appName, appVal, spark}.
        expect(extensionSource).toContain('appVal');
    });
});

describe('prefs.js cmdPreview whitespace normalisation — ISSUE 52', () => {
    it('cmdPreview replaces whitespace runs before slicing so Adw.ActionRow subtitle stays single-line', () => {
        // Gnome RDP command starts with "try {\n    const..." — a raw .slice(0,60)
        // embeds a literal \\n in the Adw.ActionRow subtitle, making the row taller
        // and offsetting the suffix buttons so the edit button cannot be clicked.
        expect(prefsSource).toMatch(/monitor\.command\.[a-zA-Z]*replace/);
    });

    it('cmdPreview trims trailing whitespace after normalisation', () => {
        // After whitespace collapse the slice must produce a clean single-line string.
        expect(prefsSource).toMatch(/command\.\S*replace[^.]*\.trim\(\)/);
    });
});

describe('prefs.js export format versioning — ISSUE 80', () => {
    it('export wraps monitors in a versioned envelope object', () => {
        // Old format was a bare JSON array; new format is {version: 1, monitors}.
        expect(prefsSource).toContain('{version: 1, monitors}');
    });

    it('import handles both bare array (legacy) and versioned envelope', () => {
        // Must not break existing exports that are bare arrays.
        expect(prefsSource).toContain('Array.isArray(parsed)');
        expect(prefsSource).toContain('parsed.monitors');
    });

    it('import rejects payloads that are neither array nor versioned envelope', () => {
        // A plain object without a monitors key should be discarded.
        expect(prefsSource).toContain('monitorsRaw');
    });
});

describe('prefs.js external preset directories — ISSUE 80', () => {
    it('defines EXTERNAL_PRESET_DIRS constant', () => {
        expect(prefsSource).toContain('EXTERNAL_PRESET_DIRS');
    });

    it('EXTERNAL_PRESET_DIRS includes system-wide path /usr/share/monish', () => {
        expect(prefsSource).toContain('/usr/share/monish');
    });

    it('EXTERNAL_PRESET_DIRS includes user-local path under get_user_data_dir', () => {
        // ~/.local/share resolves via XDG_DATA_HOME / GLib.get_user_data_dir().
        expect(prefsSource).toContain('get_user_data_dir(), \'monish\'');
    });

    it('defines loadPresetsFromDir function', () => {
        expect(prefsSource).toContain('function loadPresetsFromDir(');
    });

    it('loadPresetsFromDir attaches _sourceFile to loaded presets', () => {
        // Track which JSON file each external preset came from.
        expect(prefsSource).toContain('_sourceFile');
    });

    it('loadPresetsFromDir handles versioned envelope format from external files', () => {
        // External files may be created via Export (versioned) or manually (bare array).
        expect(prefsSource).toContain('parsed.monitors');
    });

    it('buildPresetRows loads external presets from EXTERNAL_PRESET_DIRS', () => {
        expect(prefsSource).toContain('loadPresetsFromDir(');
        expect(prefsSource).toContain('EXTERNAL_PRESET_DIRS');
    });

    it('buildPresetRows shows CAUTION badge for external presets', () => {
        // \u26A0 = \u26A0  WARNING SIGN unicode character.
        expect(prefsSource).toMatch(/\\u26A0|\u26A0/);
    });
});

describe('extension.js interval expression removed \u2014 ISSUE 112', () => {
    it('does not define _resolveInterval (removed \u2014 ISSUE 112)', () => {
        // ISSUE 112: interval expression functionality dropped; intervalSeconds used directly.
        expect(extensionSource).not.toContain('_resolveInterval');
    });

    it('does not define EXPR_RECHECK_MS (removed \u2014 ISSUE 112)', () => {
        expect(extensionSource).not.toContain('EXPR_RECHECK_MS');
    });

    it('_scheduleNextRun uses monitor.intervalSeconds directly', () => {
        expect(extensionSource).toContain('monitor.intervalSeconds');
        expect(extensionSource).not.toContain('_resolveInterval(monitor)');
    });

    it('prefs edit dialog does not include Interval Expr field', () => {
        expect(prefsSource).not.toContain('Interval Expr');
    });

    it('_setMonitorResult preserves collectedAt when skipHistory is true \u2014 ISSUE 110', () => {
        // When _applyRestoredState calls _setMonitorResult({skipHistory:true}),
        // the original collectedAt from the state file must be preserved so the
        // on-demand age label shows the real age, not "just now".
        expect(extensionSource).toContain('skipHistory');
        // The fix: use existing collectedAt when restoring, Date.now() otherwise.
        expect(extensionSource).toMatch(/skipHistory.*collectedAt|collectedAt.*skipHistory/s);
    });
});

describe('i18n \u2014 translation infrastructure', () => {
    it('extension.js uses GLib.dgettext for translations', () => {
        expect(extensionSource).toContain('GLib.dgettext');
    });

    it('prefs.js uses GLib.dgettext for translations', () => {
        expect(prefsSource).toContain('GLib.dgettext');
    });

    it('extension.js calls initTranslations in enable()', () => {
        expect(extensionSource).toContain('initTranslations');
    });

    it('prefs.js calls initTranslations in fillPreferencesWindow()', () => {
        expect(prefsSource).toContain('initTranslations');
    });

    it('po/monish2@thm.link.pot template file exists', () => {
        const potPath = join(__dirname, '..', 'po', 'monish2@thm.link.pot');
        expect(existsSync(potPath)).toBe(true);
    });

    it('at least 5 .po locale files exist in po/', () => {
        const poDir = join(__dirname, '..', 'po');
        const poFiles = existsSync(poDir)
            ? readdirSync(poDir).filter(f => f.endsWith('.po'))
            : [];
        expect(poFiles.length).toBeGreaterThanOrEqual(5);
    });
});
