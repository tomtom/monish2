/**
 * Main GNOME Shell extension entry point (GNOME 45+, ES module format).
 *
 * Registers a panel indicator that:
 *  - Shows a monitor icon whose colour reflects the worst active monitor status.
 *  - Opens a popup menu listing every enabled monitor with its latest value and
 *    a status icon (normal / caution / danger / error).
 *  - Schedules each monitor on its own GLib timeout and re-runs it whenever the
 *    user settings change.
 *  - Cleans up every GLib source and signal handler in disable() so the shell
 *    can unload the extension cleanly.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    MonitorStatus,
    MonitorType,
    deserializeMonitors,
    parseValue,
    evaluateStatus,
    worstStatus,
    intervalToMs,
    jitteredInterval,
    formatError,
} from './lib/monitor.js';
import {executeCommand, executeJavaScript} from './lib/executor.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Settings key that holds the JSON-serialised monitor array. */
const SETTINGS_KEY = 'monitors';

/** Settings key that holds the global schedule jitter percentage. */
const JITTER_KEY = 'jitter-percent';

/** Settings key for the debug-logging toggle. */
const DEBUG_LOG_KEY = 'debug-logging';

/** CSS class prefix applied to indicator and menu items for status colouring. */
const CSS_PREFIX = 'monish';

/**
 * Delay in milliseconds before monitors are first polled after the extension
 * loads. Avoids hammering the system while GNOME Shell itself is still settling.
 */
const STARTUP_GRACE_MS = 10_000;

/** Symbolic icon names for each monitor status in the popup menu rows. */
const STATUS_ICONS = {
    [MonitorStatus.PENDING]: 'content-loading-symbolic',
    [MonitorStatus.NORMAL]:  'emblem-ok-symbolic',
    [MonitorStatus.CAUTION]: 'dialog-warning-symbolic',
    [MonitorStatus.DANGER]:  'dialog-error-symbolic',
    [MonitorStatus.ERROR]:   'dialog-warning-symbolic',
};

/** Icon colour per status; applied as inline style to bypass panel theme specificity. */
const STATUS_COLORS = {
    [MonitorStatus.CAUTION]: '#e5a50a',
    [MonitorStatus.DANGER]:  '#e01b24',
    [MonitorStatus.ERROR]:   '#c64600',
};

// ---------------------------------------------------------------------------
// MonishIndicator — panel button + menu
// ---------------------------------------------------------------------------

/**
 * Panel button that owns the popup menu and all GLib scheduling.
 * Must be destroyed (via super.destroy()) to release timers and signals.
 */
const MonishIndicator = GObject.registerClass(
class MonishIndicator extends PanelMenu.Button {

    /**
     * @param {Gio.Settings} settings - Extension GSettings instance.
     * @param {function():void} openPrefs - Callback to open the prefs window.
     * @param {string} extensionPath - Filesystem path to the extension directory.
     */
    _init(settings, openPrefs, extensionPath) {
        super._init(0.0, 'Monish System Monitor');

        this._settings      = settings;
        this._openPrefs     = openPrefs;
        this._timers        = new Map();   // monitorId -> GLib source id (scheduled monitors)
        this._expiryTimers  = new Map();   // monitorId -> GLib source id (on-demand validity)
        this._results       = new Map();   // monitorId -> {value, status}
        this._monitors      = [];          // current monitor config array
        this._menuItems     = new Map();   // monitorId -> {item, statusIcon, nameLabel, inlineValueLabel, mlValueLabel, updateBtn?}
        this._debugLogPath  = GLib.build_filenamev([extensionPath, 'debug.log']);

        // Panel icon + optional error badge
        this._panelBox = new St.BoxLayout({style_class: `${CSS_PREFIX}-panel-box`});
        this._panelIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${extensionPath}/icons/monish-symbolic.svg`),
            style_class: 'system-status-icon',
        });
        this._errorBadge = new St.Label({
            text: '!',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: `${CSS_PREFIX}-error-badge`,
            visible: false,
        });
        this._panelBox.add_child(this._panelIcon);
        this._panelBox.add_child(this._errorBadge);
        this.add_child(this._panelBox);

        // Build initial menu (populates from settings).
        // Pass the startup grace period so monitors are not polled immediately.
        this._buildMenu(STARTUP_GRACE_MS);

        // React to settings changes (monitors config or jitter percentage)
        this._settingsChangedId = this._settings.connect(
            `changed::${SETTINGS_KEY}`,
            () => this._reloadMonitors()
        );
        this._jitterChangedId = this._settings.connect(
            `changed::${JITTER_KEY}`,
            () => this._reloadMonitors()
        );
    }

    // -----------------------------------------------------------------------
    // Menu construction
    // -----------------------------------------------------------------------

    /**
     * (Re)build the popup menu from the current monitor configuration.
     * Destroys existing menu items and GLib timers first.
     *
     * @param {number} [firstRunDelay=0] - Milliseconds to wait before the first
     *   monitor poll. Pass STARTUP_GRACE_MS on initial build; use 0 for reloads
     *   triggered by settings changes so new values appear immediately.
     */
    _buildMenu(firstRunDelay = 0) {
        this._stopAllTimers();  // clears _timers and _expiryTimers
        this.menu.removeAll();
        this._menuItems.clear();
        this._results.clear();

        this._monitors = deserializeMonitors(this._settings.get_string(SETTINGS_KEY));
        // intervalSeconds === 0 means disabled (same as enabled: false).
        const enabled  = this._monitors.filter(m => m.enabled && m.intervalSeconds !== 0);

        if (enabled.length === 0) {
            const empty = new PopupMenu.PopupMenuItem('No monitors configured', {reactive: false});
            this.menu.addMenuItem(empty);
        } else {
            for (const monitor of enabled) {
                this._addMonitorMenuItem(monitor);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => {
            this.menu.close();
            this._openPrefs();
        });
        this.menu.addMenuItem(settingsItem);

        // Start timers for all enabled monitors
        for (const monitor of enabled) {
            this._scheduleMonitor(monitor, firstRunDelay);
        }

        this._updatePanelIcon();
    }

    /**
     * Add a single monitor row to the popup menu.
     *
     * Layout (non-on-demand, single-line value):
     *   [statusIcon] [nameLabel …] [inlineValueLabel]
     *
     * Layout (non-on-demand, multi-line value):
     *   [statusIcon] [nameLabel …]
     *                [mlValueLabel spanning full width]
     *
     * Layout (on-demand, before click):
     *   [statusIcon] [nameLabel …] [Update button]
     *
     * Layout (on-demand, after click, value shown):
     *   Same as non-on-demand, then reverts after onDemandValidSeconds.
     *
     * @param {object} monitor - Monitor config object.
     */
    _addMonitorMenuItem(monitor) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false});

        const statusIcon = new St.Icon({
            icon_name: STATUS_ICONS[MonitorStatus.PENDING],
            style_class: `${CSS_PREFIX}-status-icon`,
            icon_size: 16,
        });

        const nameLabel = new St.Label({
            text: monitor.name,
            style_class: `${CSS_PREFIX}-monitor-name`,
        });

        // Vertical box: header row (name + right-side widget) + optional multi-line label
        const textBox = new St.BoxLayout({vertical: true, x_expand: true});
        const headerBox = new St.BoxLayout({x_expand: true});
        headerBox.add_child(nameLabel);

        // On-demand: show an "Update" button instead of a polling value
        let updateBtn = null;
        if (monitor.onDemand) {
            updateBtn = new St.Button({
                label:       'Update',
                style_class: `${CSS_PREFIX}-update-btn`,
                reactive:    true,
            });
            updateBtn.connect('clicked', () => {
                updateBtn.reactive = false;
                updateBtn.label    = '…';
                this._runMonitor(monitor);
            });
            headerBox.add_child(updateBtn);
        }

        // Inline value label — right side of header row; hidden while on-demand button shows
        const inlineValueLabel = new St.Label({
            text:        monitor.onDemand ? '' : '…',
            style_class: `${CSS_PREFIX}-monitor-value`,
            visible:     !monitor.onDemand,
        });
        headerBox.add_child(inlineValueLabel);

        // Multi-line label — below the header row; hidden until value has newlines
        const mlValueLabel = new St.Label({
            text:        '',
            style_class: `${CSS_PREFIX}-monitor-value-multiline`,
            visible:     false,
            x_expand:    true,
        });
        mlValueLabel.get_clutter_text().set_line_wrap(true);

        textBox.add_child(headerBox);
        textBox.add_child(mlValueLabel);

        item.add_child(statusIcon);
        item.add_child(textBox);

        this.menu.addMenuItem(item);
        this._menuItems.set(monitor.id, {item, statusIcon, nameLabel, inlineValueLabel, mlValueLabel, updateBtn});
    }

    // -----------------------------------------------------------------------
    // Scheduling and execution
    // -----------------------------------------------------------------------

    /**
     * Schedule a monitor for repeated execution.
     * On-demand monitors are skipped — they run only when the user clicks Update.
     * Each repeat interval is independently jittered so polls don't cluster.
     *
     * @param {object} monitor
     * @param {number} [firstRunDelay=0] - Milliseconds before the first poll.
     */
    _scheduleMonitor(monitor, firstRunDelay = 0) {
        if (monitor.onDemand) return;

        const intervalMs    = Math.max(1000, intervalToMs(monitor.intervalSeconds, 'seconds'));
        const jitterPercent = this._settings.get_int(JITTER_KEY);

        // Each run self-schedules the next one so jitter is resampled every interval.
        const scheduleNext = () => {
            const ms       = jitteredInterval(intervalMs, jitterPercent);
            const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._timers.delete(monitor.id);
                this._runMonitor(monitor);
                scheduleNext();
                return GLib.SOURCE_REMOVE;
            });
            this._timers.set(monitor.id, sourceId);
        };

        // One-shot delay before the first run; then switches to self-scheduling.
        const firstId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, firstRunDelay, () => {
            this._timers.delete(monitor.id);
            this._runMonitor(monitor);
            scheduleNext();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.set(monitor.id, firstId);
    }

    /**
     * Execute one monitor command, parse output, and update the menu item.
     *
     * @param {object} monitor
     */
    async _runMonitor(monitor) {
        try {
            const execute = monitor.type === MonitorType.JAVASCRIPT
                ? executeJavaScript
                : executeCommand;
            const stdout = await execute(monitor.command, 30);
            const value  = parseValue(stdout, monitor.outputRegex);
            const status = evaluateStatus(value, monitor.cautionPatterns, monitor.dangerPatterns);
            this._setMonitorResult(monitor.id, value, status);
            this._appendDebugLog(monitor, value);
        } catch (e) {
            const errStr = formatError(e);
            this._setMonitorResult(monitor.id, errStr, MonitorStatus.ERROR);
            this._appendDebugLog(monitor, `error: ${errStr}`);
        }
    }

    /**
     * Append one log entry to the debug log file when debug logging is enabled.
     * No-ops when the setting is off or on any write failure.
     *
     * @param {object} monitor - Monitor config object (name and type fields used).
     * @param {string} value   - Display value or 'error: …' string from the run.
     */
    _appendDebugLog(monitor, value) {
        if (!this._settings.get_boolean(DEBUG_LOG_KEY)) return;
        try {
            const ts     = new Date().toISOString();
            const line   = `${ts} | ${monitor.name} | ${monitor.type} | ${value}\n`;
            const file   = Gio.File.new_for_path(this._debugLogPath);
            const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
            stream.write_all(new TextEncoder().encode(line), null);
            stream.close(null);
        } catch (_) {}
    }

    /**
     * Update stored result and refresh the corresponding menu row + panel icon.
     * For on-demand monitors: hides the Update button, shows the value, then
     * schedules a one-shot timer to revert back to the button after the monitor's
     * validity period expires.
     * For all monitors: chooses inline (single-line) or below-name (multi-line)
     * display based on whether the value contains newlines.
     *
     * @param {string} id     - Monitor id.
     * @param {string} value  - Extracted display value.
     * @param {string} status - One of MonitorStatus values.
     */
    _setMonitorResult(id, value, status) {
        this._results.set(id, {value, status});

        const entry = this._menuItems.get(id);
        if (entry) {
            // On-demand: reveal value and arm expiry timer
            if (entry.updateBtn) {
                entry.updateBtn.visible = false;

                const monitor  = this._monitors.find(m => m.id === id);
                const validMs  = Math.max(1000, (monitor?.onDemandValidSeconds ?? 60) * 1000);
                const existing = this._expiryTimers.get(id);
                if (existing) GLib.source_remove(existing);
                const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, validMs, () => {
                    this._resetOnDemandMonitor(id);
                    this._expiryTimers.delete(id);
                    return GLib.SOURCE_REMOVE;
                });
                this._expiryTimers.set(id, timerId);
            }

            // Choose inline vs below-name layout based on newlines in value
            const isMulti = value.includes('\n');
            entry.inlineValueLabel.visible = !isMulti;
            entry.inlineValueLabel.text    = isMulti ? '' : value;
            entry.mlValueLabel.visible     = isMulti;
            entry.mlValueLabel.text        = isMulti ? value : '';

            entry.statusIcon.icon_name = STATUS_ICONS[status] ?? STATUS_ICONS[MonitorStatus.NORMAL];
            const styles = Object.values(MonitorStatus).map(s => `${CSS_PREFIX}-status-${s}`);
            styles.forEach(c => entry.item.remove_style_class_name(c));
            entry.item.add_style_class_name(`${CSS_PREFIX}-status-${status}`);
        }

        this._updatePanelIcon();
    }

    /**
     * Revert an on-demand monitor back to its "Update" button state.
     * Called when the validity timer fires.  Clears the stored result so the
     * panel icon no longer reflects this monitor's last value.
     *
     * @param {string} id - Monitor id.
     */
    _resetOnDemandMonitor(id) {
        this._results.delete(id);
        const entry = this._menuItems.get(id);
        if (entry?.updateBtn) {
            entry.updateBtn.visible    = true;
            entry.updateBtn.reactive   = true;
            entry.updateBtn.label      = 'Update';
            entry.inlineValueLabel.visible = false;
            entry.mlValueLabel.visible     = false;
            entry.statusIcon.icon_name = STATUS_ICONS[MonitorStatus.PENDING];
            const styles = Object.values(MonitorStatus).map(s => `${CSS_PREFIX}-status-${s}`);
            styles.forEach(c => entry.item.remove_style_class_name(c));
        }
        this._updatePanelIcon();
    }

    // -----------------------------------------------------------------------
    // Panel icon state
    // -----------------------------------------------------------------------

    /**
     * Recompute the worst status across all monitors and update the panel icon
     * colour and badge visibility accordingly.
     *
     * Colour is applied via inline style in addition to a CSS class because the
     * GNOME Shell panel theme may have higher-specificity rules that override
     * extension stylesheet colour properties.
     */
    _updatePanelIcon() {
        const statuses = [...this._results.values()].map(r => r.status);
        const worst    = worstStatus(statuses);

        // CSS class for stylesheet-based theming
        const classes = Object.values(MonitorStatus).map(s => `${CSS_PREFIX}-indicator-${s}`);
        classes.forEach(c => this._panelIcon.remove_style_class_name(c));
        this._panelIcon.add_style_class_name(`${CSS_PREFIX}-indicator-${worst}`);

        // Inline style overrides panel theme; cleared for normal/pending
        const color = STATUS_COLORS[worst] ?? null;
        this._panelIcon.style = color ? `color: ${color};` : '';

        // Show badge for any alerting state (caution, danger, or error)
        const alerting = worst === MonitorStatus.CAUTION
                      || worst === MonitorStatus.DANGER
                      || worst === MonitorStatus.ERROR;
        this._errorBadge.visible = alerting;
        if (alerting && color) {
            this._errorBadge.style = `color: ${color};`;
        }
    }

    // -----------------------------------------------------------------------
    // Settings reload
    // -----------------------------------------------------------------------

    /**
     * Called whenever the monitors GSettings key changes.
     * Tears down all timers and rebuilds from scratch.
     */
    _reloadMonitors() {
        this._buildMenu();
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    /**
     * Cancel every active GLib timer (scheduled polls and on-demand expiry).
     * Must be called before destroying the indicator to avoid orphaned sources.
     */
    _stopAllTimers() {
        for (const sourceId of this._timers.values()) {
            GLib.source_remove(sourceId);
        }
        this._timers.clear();
        for (const sourceId of this._expiryTimers.values()) {
            GLib.source_remove(sourceId);
        }
        this._expiryTimers.clear();
    }

    /**
     * Full cleanup — disconnect signals, stop timers, destroy UI.
     */
    destroy() {
        this._stopAllTimers();
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._jitterChangedId) {
            this._settings.disconnect(this._jitterChangedId);
            this._jitterChangedId = null;
        }
        super.destroy();
    }
});

// ---------------------------------------------------------------------------
// Extension class
// ---------------------------------------------------------------------------

export default class MonishExtension extends Extension {

    enable() {
        this._settings  = this.getSettings();
        this._indicator = new MonishIndicator(
            this._settings,
            () => this.openPreferences(),
            this.path
        );
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}
