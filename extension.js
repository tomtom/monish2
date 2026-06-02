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
    countAlertStatuses,
    intervalToMs,
    jitteredInterval,
    formatError,
    extractNumber,
    buildSparkline,
    SPARKLINE_MAX_VALUES,
    injectArgs,
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
        this._menuItems     = new Map();   // monitorId -> {item, statusIcon, nameLabel, inlineValueLabel, mlValueLabel}
        this._history       = new Map();   // monitorId -> number[] ring buffer (max SPARKLINE_MAX_VALUES)
        this._appHistory    = new Map();   // monitorId -> Map<appName, number[]> for multi-line per-app sparklines
        this._debugLogPath  = GLib.build_filenamev([extensionPath, 'debug.log']);
        this._stateFileDir  = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'monish2']);
        this._stateFilePath = GLib.build_filenamev([this._stateFileDir, 'state.json']);

        // Floating tooltip widget shown when hovering over a monitor value
        this._tooltip = new St.Label({style_class: `${CSS_PREFIX}-tooltip`, visible: false});
        Main.layoutManager.addTopChrome(this._tooltip);

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
        this._history.clear();
        this._appHistory.clear();

        // Normalise: intervalSeconds === 0 means on-demand; derive onDemand so all
        // downstream code uses monitor.onDemand regardless of how old data was stored.
        this._monitors = deserializeMonitors(this._settings.get_string(SETTINGS_KEY))
            .map(m => ({...m, onDemand: m.onDemand || m.intervalSeconds === 0}));

        this._loadState();
        const enabled  = this._monitors.filter(m => m.enabled);

        if (enabled.length === 0) {
            const empty = new PopupMenu.PopupMenuItem('No monitors configured', {reactive: false});
            this.menu.addMenuItem(empty);
        } else {
            for (const monitor of enabled) {
                this._addMonitorMenuItem(monitor);
            }
        }

        this._applyRestoredState();

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
     * Position and show the shared tooltip label near the current pointer.
     * Placed ABOVE the cursor so it is never hidden by the menu below.
     * No-ops when text is empty so monitors without descriptions stay silent.
     *
     * @param {string} text - Description text to display.
     */
    _showTooltip(text) {
        if (!text) return;
        this._tooltip.text = text;
        const [px, py] = global.get_pointer();
        // Measure natural height so the tooltip clears the pointer vertically.
        const [, tooltipH] = this._tooltip.get_preferred_height(-1);
        this._tooltip.set_position(px + 12, py - (tooltipH || 24) - 12);
        this._tooltip.visible = true;
    }

    /** Hide the shared tooltip label. */
    _hideTooltip() {
        this._tooltip.visible = false;
    }

    /**
     * Add a single monitor row to the popup menu.
     *
     * Layout (single-line value):
     *   [statusIcon] [nameLabel (clickable)] [inlineValueLabel]
     *
     * Layout (multi-line value):
     *   [statusIcon] [nameLabel (clickable)]
     *                [mlBox: [lineText (x_expand)] [lineSpark] per line]
     *
     * Clicking the name immediately re-runs the monitor and resets its timer.
     * On-demand monitors show no value until clicked; value reverts after validity expires.
     *
     * @param {object} monitor - Monitor config object.
     */
    _addMonitorMenuItem(monitor) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false});

        const hasActions = (monitor.actions ?? []).length > 0;

        // statusIcon always shows the real monitor status via STATUS_ICONS.
        // For action monitors a border class is added to signal interactivity.
        const statusIcon = new St.Icon({
            icon_name:   STATUS_ICONS[MonitorStatus.PENDING],
            icon_size:   16,
            style_class: `${CSS_PREFIX}-status-icon`,
            y_align:     Clutter.ActorAlign.START,
        });
        if (hasActions) {
            statusIcon.add_style_class_name(`${CSS_PREFIX}-action-icon`);
        }
        const statusIconWidget = statusIcon;

        // Name is a button so it receives clicks, changes cursor, and handles hover.
        // x_expand pushes the value and sparkline labels to the right edge of the row.
        const nameLabel = new St.Button({
            label:       monitor.name,
            style_class: `${CSS_PREFIX}-monitor-name`,
            x_align:     Clutter.ActorAlign.START,
            x_expand:    true,
        });
        nameLabel.connect('clicked', () => this._triggerMonitor(monitor));

        // Vertical box: header row (name + value) + optional multi-line value label
        const textBox = new St.BoxLayout({vertical: true, x_expand: true});
        const headerBox = new St.BoxLayout({x_expand: true});
        headerBox.add_child(nameLabel);

        // Inline value — right side; hidden for on-demand until first run
        const inlineValueLabel = new St.Label({
            text:        monitor.onDemand ? '' : '…',
            style_class: `${CSS_PREFIX}-monitor-value`,
            visible:     !monitor.onDemand,
        });
        headerBox.add_child(inlineValueLabel);

        // Sparkline sits at the right edge, updated separately from the value text.
        const sparklineLabel = new St.Label({
            text:        '',
            style_class: `${CSS_PREFIX}-monitor-sparkline`,
        });
        headerBox.add_child(sparklineLabel);

        // Multi-line value label kept for compatibility; hidden in favour of mlBox.
        const mlValueLabel = new St.Label({
            text:        '',
            style_class: `${CSS_PREFIX}-monitor-value-multiline`,
            visible:     false,
            x_expand:    true,
        });
        mlValueLabel.get_clutter_text().set_line_wrap(true);

        // Per-line container: one HBox per output line so sparklines can be right-aligned.
        const mlBox = new St.BoxLayout({
            vertical:    true,
            x_expand:    true,
            visible:     false,
            style_class: `${CSS_PREFIX}-monitor-multiline-box`,
        });

        // Show description as a tooltip when hovering over value labels.
        if (monitor.description) {
            const desc = monitor.description;
            for (const lbl of [inlineValueLabel, mlValueLabel, mlBox]) {
                lbl.reactive = true;
                lbl.connect('enter-event', () => this._showTooltip(desc));
                lbl.connect('leave-event', () => this._hideTooltip());
            }
        }

        // Actions drop-down: shown when the status icon is clicked.
        // One St.Button per action, hidden by default.
        const actionsBox = new St.BoxLayout({
            vertical:    true,
            style_class: `${CSS_PREFIX}-actions-box`,
            visible:     false,
        });
        // actionBtns pairs each button with its optional guard expression so
        // _setMonitorResult can show/hide individual buttons per the current value.
        const actionBtns = [];
        for (const action of (monitor.actions ?? [])) {
            const actionBtn = new St.Button({
                label:       action.label || action.command,
                style_class: `${CSS_PREFIX}-action-button`,
                x_align:     Clutter.ActorAlign.START,
            });
            actionBtn.connect('clicked', () => this._runAction(monitor, action));
            actionsBox.add_child(actionBtn);
            actionBtns.push({btn: actionBtn, guard: action.guard ?? ''});
        }

        // Clicking the status icon (or its container) toggles the actions panel.
        if (hasActions) {
            statusIconWidget.reactive = true;
            statusIconWidget.connect('button-press-event', () => {
                actionsBox.visible = !actionsBox.visible;
                return true; // stop propagation so the menu item doesn't close
            });
        }

        textBox.add_child(headerBox);
        textBox.add_child(mlValueLabel);
        textBox.add_child(mlBox);
        textBox.add_child(actionsBox);

        item.add_child(statusIconWidget);
        item.add_child(textBox);

        this.menu.addMenuItem(item);
        this._menuItems.set(monitor.id, {item, statusIcon, nameLabel, inlineValueLabel, mlValueLabel, mlBox, sparklineLabel, actionsBox, actionBtns});
    }

    // -----------------------------------------------------------------------
    // Scheduling and execution
    // -----------------------------------------------------------------------

    /**
     * Schedule a monitor for repeated execution.
     * On-demand monitors are skipped — they run only when the user clicks the name.
     * Each repeat interval is independently jittered so polls don't cluster.
     *
     * @param {object} monitor
     * @param {number} [firstRunDelay=0] - Milliseconds before the first poll.
     */
    _scheduleMonitor(monitor, firstRunDelay = 0) {
        if (monitor.onDemand) return;

        // One-shot delay before the first run; then switches to self-scheduling.
        const firstId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, firstRunDelay, () => {
            this._timers.delete(monitor.id);
            this._runMonitor(monitor);
            this._scheduleNextRun(monitor);
            return GLib.SOURCE_REMOVE;
        });
        this._timers.set(monitor.id, firstId);
    }

    /**
     * Schedule the next timed poll for a regular (non-on-demand) monitor.
     * Resamples jitter on every call so successive intervals are independent.
     *
     * @param {object} monitor
     */
    _scheduleNextRun(monitor) {
        const intervalMs    = Math.max(1000, intervalToMs(monitor.intervalSeconds, 'seconds'));
        const jitterPercent = this._settings.get_int(JITTER_KEY);
        const ms            = jitteredInterval(intervalMs, jitterPercent);
        const sourceId      = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(monitor.id);
            this._runMonitor(monitor);
            this._scheduleNextRun(monitor);
            return GLib.SOURCE_REMOVE;
        });
        this._timers.set(monitor.id, sourceId);
    }

    /**
     * Immediately run a monitor on user request (name-label click).
     * Cancels any pending scheduled timer and restarts it after the run completes,
     * so the next automatic poll is counted from now.
     * On-demand monitors show a loading indicator while the command executes.
     *
     * @param {object} monitor
     */
    async _triggerMonitor(monitor) {
        // Cancel any in-flight or pending scheduled timer for this monitor.
        const existingId = this._timers.get(monitor.id);
        if (existingId !== undefined) {
            GLib.source_remove(existingId);
            this._timers.delete(monitor.id);
        }

        // Show loading indicator while command runs.
        const entry = this._menuItems.get(monitor.id);
        if (entry) {
            entry.inlineValueLabel.visible = true;
            entry.inlineValueLabel.text    = '…';
            entry.sparklineLabel.text      = '';
            entry.mlValueLabel.visible     = false;
            entry.mlBox.visible            = false;
        }

        await this._runMonitor(monitor);

        // Re-arm the periodic timer from now (on-demand monitors have no timer).
        if (!monitor.onDemand) {
            this._scheduleNextRun(monitor);
        }
    }

    /**
     * Execute one monitor command, parse output, and update the menu item.
     *
     * @param {object} monitor
     */
    async _runMonitor(monitor) {
        try {
            const command = injectArgs(
                monitor.command,
                monitor.type,
                monitor.args ?? [],
                monitor.argValues ?? {},
            );
            const execute = monitor.type === MonitorType.JAVASCRIPT
                ? executeJavaScript
                : executeCommand;
            const stdout = await execute(command, 30);
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
     * Execute one action command for a monitor, then refresh the monitor value.
     * Action errors are silently swallowed so a failing action doesn't block the update.
     *
     * @param {object} monitor - Monitor config object.
     * @param {object} action  - Action definition: {label, command, type}.
     */
    async _runAction(monitor, action) {
        try {
            const execute = action.type === MonitorType.JAVASCRIPT
                ? executeJavaScript
                : executeCommand;
            await execute(action.command, 30);
        } catch (_) {}
        await this._runMonitor(monitor);
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
            const line   = `${ts}\t${monitor.name}\t${monitor.type}\t${value}\n`;
            const file   = Gio.File.new_for_path(this._debugLogPath);
            const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
            stream.write_all(new TextEncoder().encode(line), null);
            stream.close(null);
        } catch (_) {}
    }

    // -----------------------------------------------------------------------
    // State persistence (/run/user/$UID/monish2/state.json, RAM-backed tmpfs)
    // Survives GNOME Shell context destruction on screen lock, dies on reboot.
    // -----------------------------------------------------------------------

    /**
     * Persist _results, _history, _appHistory to a JSON file in the
     * user runtime directory (tmpfs, /run/user/$UID/monish2/state.json).
     * Only writes when there is data to preserve.
     */
    _saveState() {
        if (this._results.size === 0) return;
        try {
            GLib.mkdir_with_parents(this._stateFileDir, 0o755);
            const data = JSON.stringify({
                results:    Object.fromEntries(this._results),
                history:    Object.fromEntries(this._history),
                appHistory: Object.fromEntries(
                    [...this._appHistory].map(([id, perApp]) => [id, Object.fromEntries(perApp)])
                ),
            });
            GLib.file_set_contents(this._stateFilePath, new TextEncoder().encode(data));
        } catch (_) {}
    }

    /**
     * Restore _results, _history, _appHistory from the state file.
     * Only restores monitors that still exist in the current config.
     */
    _loadState() {
        try {
            const [ok, bytes] = GLib.file_get_contents(this._stateFilePath);
            if (!ok) return;
            const data = JSON.parse(new TextDecoder().decode(bytes));
            const validIds = new Set(this._monitors.map(m => m.id));

            if (data.history) {
                for (const [id, hist] of Object.entries(data.history)) {
                    if (validIds.has(id)) this._history.set(id, hist);
                }
            }
            if (data.appHistory) {
                for (const [id, perApp] of Object.entries(data.appHistory)) {
                    if (validIds.has(id)) this._appHistory.set(id, new Map(Object.entries(perApp)));
                }
            }
            if (data.results) {
                for (const [id, result] of Object.entries(data.results)) {
                    if (validIds.has(id)) this._results.set(id, result);
                }
            }
        } catch (_) {}
    }

    /** Restore menu item UI from loaded state (history already populated). */
    _applyRestoredState() {
        for (const [id, {value, status}] of this._results) {
            this._setMonitorResult(id, value, status, {skipHistory: true});
        }
        // On-demand monitors should not show stale values
        for (const monitor of this._monitors) {
            if (monitor.onDemand && this._results.has(monitor.id)) {
                this._results.delete(monitor.id);
            }
        }
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
    _setMonitorResult(id, value, status, {skipHistory = false} = {}) {
        // Update sparkline history with the numeric component of this value.
        // Error states are excluded so spurious numbers in error messages don't skew the graph.
        if (!skipHistory && status !== MonitorStatus.ERROR) {
            const num = extractNumber(value);
            if (!isNaN(num)) {
                const hist = this._history.get(id) ?? [];
                hist.push(num);
                if (hist.length > SPARKLINE_MAX_VALUES) hist.shift();
                this._history.set(id, hist);
            }
        }

        this._results.set(id, {value, status});

        const entry = this._menuItems.get(id);
        if (entry) {
            // On-demand: arm an expiry timer that clears the value after validity window.
            const monitor = this._monitors.find(m => m.id === id);
            if (monitor?.onDemand) {
                const validMs  = Math.max(1000, (monitor.onDemandValidSeconds ?? 60) * 1000);
                const existing = this._expiryTimers.get(id);
                if (existing) GLib.source_remove(existing);
                const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, validMs, () => {
                    this._resetOnDemandMonitor(id);
                    this._expiryTimers.delete(id);
                    return GLib.SOURCE_REMOVE;
                });
                this._expiryTimers.set(id, timerId);
            }

            const showSpark = monitor?.showSparkline !== false;
            const sparkline = showSpark ? buildSparkline(this._history.get(id) ?? []) : '';
            const isMulti   = value.includes('\n');

            if (isMulti) {
                // Per-app sparklines: each line is "appName value"; update per-app ring buffer.
                const perApp = this._appHistory.get(id) ?? new Map();
                const perLines = value.split('\n').map(line => {
                    const parts   = line.trim().split(/\s+/);
                    const appName = parts[0] ?? '';
                    const appVal  = parts.slice(1).join(' ');
                    const num     = extractNumber(appVal);
                    if (appName && !isNaN(num)) {
                        const hist = perApp.get(appName) ?? [];
                        hist.push(num);
                        if (hist.length > SPARKLINE_MAX_VALUES) hist.shift();
                        perApp.set(appName, hist);
                    }
                    const spark = showSpark ? buildSparkline(perApp.get(appName) ?? []) : '';
                    return {appName, appVal, spark};
                });
                this._appHistory.set(id, perApp);

                // Rebuild mlBox with one [lineText (x_expand) | lineVal | lineSpark] row per line.
                // lineText holds the process name; lineVal holds the right-aligned numeric value
                // matching the single-line inlineValueLabel layout (ISSUE 76).
                let mlChild = entry.mlBox.get_first_child();
                while (mlChild) {
                    const next = mlChild.get_next_sibling();
                    entry.mlBox.remove_child(mlChild);
                    mlChild = next;
                }
                for (const {appName, appVal, spark} of perLines) {
                    const lineRow = new St.BoxLayout({x_expand: true});
                    const lineText = new St.Label({
                        text:        appName,
                        x_expand:    true,
                        style_class: `${CSS_PREFIX}-monitor-value-multiline`,
                    });
                    const lineVal = new St.Label({
                        text:        appVal,
                        style_class: `${CSS_PREFIX}-monitor-value`,
                    });
                    const lineSpark = new St.Label({
                        text:        spark,
                        style_class: `${CSS_PREFIX}-monitor-sparkline`,
                    });
                    lineRow.add_child(lineText);
                    lineRow.add_child(lineVal);
                    lineRow.add_child(lineSpark);
                    entry.mlBox.add_child(lineRow);
                }
                entry.inlineValueLabel.visible  = false;
                entry.inlineValueLabel.text     = '';
                entry.sparklineLabel.text       = '';
                entry.mlValueLabel.visible      = false;
                entry.mlBox.visible             = true;
            } else {
                // Sparkline goes into the dedicated right-aligned sparklineLabel widget.
                entry.inlineValueLabel.visible  = true;
                entry.inlineValueLabel.text     = value;
                entry.sparklineLabel.text       = sparkline;
                entry.mlValueLabel.visible      = false;
                entry.mlValueLabel.text         = '';
                entry.mlBox.visible             = false;
            }

            entry.statusIcon.icon_name = STATUS_ICONS[status] ?? STATUS_ICONS[MonitorStatus.NORMAL];
            const styles = Object.values(MonitorStatus).map(s => `${CSS_PREFIX}-status-${s}`);
            styles.forEach(c => entry.item.remove_style_class_name(c));
            entry.item.add_style_class_name(`${CSS_PREFIX}-status-${status}`);
            if (entry.statusIcon.has_style_class_name(`${CSS_PREFIX}-action-icon`)) {
                const borderColor = STATUS_COLORS[status];
                entry.statusIcon.style = borderColor ? `border-color: ${borderColor};` : null;
            }

            // Evaluate each action button's guard with the current value and
            // show/hide accordingly.  Buttons with no guard are always visible.
            for (const {btn, guard} of (entry.actionBtns ?? [])) {
                if (!guard) continue;
                try {
                    // eslint-disable-next-line no-new-func
                    btn.visible = Boolean(new Function('value', `return (${guard})`)(value));
                } catch (_) {
                    btn.visible = true; // malformed guard → always show
                }
            }
        }

        this._saveState();
        this._updatePanelIcon();
    }

    /**
     * Called when the validity timer fires.  Clears the stored result so the
     * panel icon no longer reflects this monitor's last value.
     *
     * @param {string} id - Monitor id.
     */
    _resetOnDemandMonitor(id) {
        this._results.delete(id);
        const entry = this._menuItems.get(id);
        if (entry) {
            entry.inlineValueLabel.visible = false;
            entry.inlineValueLabel.text    = '';
            entry.sparklineLabel.text      = '';
            entry.mlValueLabel.visible     = false;
            entry.mlBox.visible            = false;
            entry.statusIcon.icon_name = STATUS_ICONS[MonitorStatus.PENDING];
            if (entry.statusIcon.has_style_class_name(`${CSS_PREFIX}-action-icon`))
                entry.statusIcon.style = null;
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
        // Use as many exclamation marks as there are CAUTION/DANGER monitors
        const alertCount = countAlertStatuses(statuses);
        this._errorBadge.text = alertCount > 0 ? '!'.repeat(alertCount) : '!';
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
        this._saveState();
        this._stopAllTimers();
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._jitterChangedId) {
            this._settings.disconnect(this._jitterChangedId);
            this._jitterChangedId = null;
        }
        if (this._tooltip) {
            Main.layoutManager.removeChrome(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
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
