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
    deserializeMonitors,
    parseValue,
    evaluateStatus,
    worstStatus,
    intervalToMs,
} from './lib/monitor.js';
import {executeCommand} from './lib/executor.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Settings key that holds the JSON-serialised monitor array. */
const SETTINGS_KEY = 'monitors';

/** CSS class prefix applied to indicator and menu items for status colouring. */
const CSS_PREFIX = 'monish';

/** Symbolic icon names for each monitor status in the popup menu rows. */
const STATUS_ICONS = {
    [MonitorStatus.PENDING]: 'content-loading-symbolic',
    [MonitorStatus.NORMAL]:  'emblem-ok-symbolic',
    [MonitorStatus.CAUTION]: 'dialog-warning-symbolic',
    [MonitorStatus.DANGER]:  'dialog-error-symbolic',
    [MonitorStatus.ERROR]:   'dialog-warning-symbolic',
};

/** Panel icon to use at each overall severity level. */
const PANEL_ICONS = {
    [MonitorStatus.PENDING]: 'utilities-system-monitor-symbolic',
    [MonitorStatus.NORMAL]:  'utilities-system-monitor-symbolic',
    [MonitorStatus.CAUTION]: 'utilities-system-monitor-symbolic',
    [MonitorStatus.DANGER]:  'utilities-system-monitor-symbolic',
    [MonitorStatus.ERROR]:   'utilities-system-monitor-symbolic',
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
     */
    _init(settings, openPrefs) {
        super._init(0.0, 'Monish System Monitor');

        this._settings   = settings;
        this._openPrefs  = openPrefs;
        this._timers     = new Map();   // monitorId -> GLib source id
        this._results    = new Map();   // monitorId -> {value, status}
        this._monitors   = [];          // current monitor config array
        this._menuItems  = new Map();   // monitorId -> {row, statusIcon, valueLabel}

        // Panel icon + optional error badge
        this._panelBox = new St.BoxLayout({style_class: `${CSS_PREFIX}-panel-box`});
        this._panelIcon = new St.Icon({
            icon_name: 'utilities-system-monitor-symbolic',
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

        // Build initial menu (populates from settings)
        this._buildMenu();

        // React to settings changes
        this._settingsChangedId = this._settings.connect(
            `changed::${SETTINGS_KEY}`,
            () => this._reloadMonitors()
        );
    }

    // -----------------------------------------------------------------------
    // Menu construction
    // -----------------------------------------------------------------------

    /**
     * (Re)build the popup menu from the current monitor configuration.
     * Destroys existing menu items and GLib timers first.
     */
    _buildMenu() {
        this._stopAllTimers();
        this.menu.removeAll();
        this._menuItems.clear();
        this._results.clear();

        this._monitors = deserializeMonitors(this._settings.get_string(SETTINGS_KEY));
        const enabled  = this._monitors.filter(m => m.enabled);

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
            this._scheduleMonitor(monitor);
        }

        this._updatePanelIcon();
    }

    /**
     * Add a single monitor row to the popup menu.
     * Row layout: [status-icon] [name label ............ value label]
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
            x_expand: true,
        });

        const valueLabel = new St.Label({
            text: '…',
            style_class: `${CSS_PREFIX}-monitor-value`,
        });

        item.add_child(statusIcon);
        item.add_child(nameLabel);
        item.add_child(valueLabel);

        this.menu.addMenuItem(item);
        this._menuItems.set(monitor.id, {item, statusIcon, nameLabel, valueLabel});
    }

    // -----------------------------------------------------------------------
    // Scheduling and execution
    // -----------------------------------------------------------------------

    /**
     * Schedule a monitor for repeated execution.
     * Runs once immediately, then repeats at the configured interval.
     *
     * @param {object} monitor
     */
    _scheduleMonitor(monitor) {
        // Run immediately on first load
        this._runMonitor(monitor);

        const intervalMs = Math.max(1000, intervalToMs(monitor.intervalSeconds, 'seconds'));
        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            this._runMonitor(monitor);
            return GLib.SOURCE_CONTINUE;
        });
        this._timers.set(monitor.id, sourceId);
    }

    /**
     * Execute one monitor command, parse output, and update the menu item.
     *
     * @param {object} monitor
     */
    async _runMonitor(monitor) {
        try {
            const stdout = await executeCommand(monitor.command, 30);
            const value  = parseValue(stdout, monitor.outputRegex);
            const status = evaluateStatus(value, monitor.cautionPatterns, monitor.dangerPatterns);
            this._setMonitorResult(monitor.id, value, status);
        } catch (e) {
            const msg = e.message === 'timeout' ? 'timeout' : 'error';
            this._setMonitorResult(monitor.id, msg, MonitorStatus.ERROR);
        }
    }

    /**
     * Update stored result and refresh the corresponding menu row + panel icon.
     *
     * @param {string} id     - Monitor id.
     * @param {string} value  - Extracted display value.
     * @param {string} status - One of MonitorStatus values.
     */
    _setMonitorResult(id, value, status) {
        this._results.set(id, {value, status});

        const entry = this._menuItems.get(id);
        if (entry) {
            entry.valueLabel.text = value;
            entry.statusIcon.icon_name = STATUS_ICONS[status] ?? STATUS_ICONS[MonitorStatus.NORMAL];
            // Remove all status CSS classes, then add the current one
            const styles = Object.values(MonitorStatus).map(s => `${CSS_PREFIX}-status-${s}`);
            styles.forEach(c => entry.item.remove_style_class_name(c));
            entry.item.add_style_class_name(`${CSS_PREFIX}-status-${status}`);
        }

        this._updatePanelIcon();
    }

    // -----------------------------------------------------------------------
    // Panel icon state
    // -----------------------------------------------------------------------

    /**
     * Recompute the worst status across all monitors and update the panel icon
     * CSS class and error badge visibility accordingly.
     */
    _updatePanelIcon() {
        const statuses = [...this._results.values()].map(r => r.status);
        const worst    = worstStatus(statuses);

        // Remove all status CSS classes, then apply current one
        const classes = Object.values(MonitorStatus).map(s => `${CSS_PREFIX}-indicator-${s}`);
        classes.forEach(c => this._panelIcon.remove_style_class_name(c));
        this._panelIcon.add_style_class_name(`${CSS_PREFIX}-indicator-${worst}`);

        // Show "!" badge if any monitor errored
        const hasError = statuses.some(s => s === MonitorStatus.ERROR);
        this._errorBadge.visible = hasError;
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
     * Cancel every active GLib timer.  Must be called before destroying the
     * indicator to avoid orphaned sources.
     */
    _stopAllTimers() {
        for (const sourceId of this._timers.values()) {
            GLib.source_remove(sourceId);
        }
        this._timers.clear();
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
            () => this.openPreferences()
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
