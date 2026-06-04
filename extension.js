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
    jitteredInterval,
    formatError,
    extractNumber,
    buildSparklineMarkup,
    SPARKLINE_MAX_VALUES,
    injectArgs,
    formatAge,
    evaluateGuard,
} from './lib/monitor.js';
import {executeCommand, executeJavaScript} from './lib/executor.js';

const _ = (str) => GLib.dgettext('monish2@thm.link', str);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Settings key that holds the JSON-serialised monitor array. */
const SETTINGS_KEY = 'monitors';

/** Settings key that holds the global schedule jitter percentage. */
const JITTER_KEY = 'jitter-percent';

/* DEBUG_ONLY_BEGIN */
/** Settings key for the debug-logging toggle. */
const DEBUG_LOG_KEY = 'debug-logging';
/* DEBUG_ONLY_END */

/** Settings key for on-demand monitor time display mode. */
const ON_DEMAND_TIME_KEY = 'on-demand-time-display';

/** CSS class prefix applied to indicator and menu items for status colouring. */
const CSS_PREFIX = 'monish';

/**
 * Delay in milliseconds before monitors are first polled after the extension
 * loads. Avoids hammering the system while GNOME Shell itself is still settling.
 */
const STARTUP_GRACE_MS = 10_000;

/** Badge appended to an on-demand monitor name when its last value is stale. */
const STALE_BADGE = ' ❓';

/** Age threshold (ms) above which an on-demand monitor's value is considered stale. */
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

/** Base icon for each monitor type in the popup menu rows. */
const BASE_ICONS = {
    plain:   'media-record-symbolic',  // dot — plain monitors (no actions)
    actions: 'open-menu-symbolic',     // hamburger — monitors with action buttons
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
        this._ageTimers     = new Map();   // monitorId -> GLib source id (age label refresh)
        this._results       = new Map();   // monitorId -> {value, status}
        this._monitors      = [];          // current monitor config array
        this._menuItems     = new Map();   // monitorId -> {item, statusIcon, nameLabel, inlineValueLabel, mlValueLabel}
        this._history       = new Map();   // monitorId -> number[] ring buffer (max SPARKLINE_MAX_VALUES)
        this._appHistory    = new Map();   // monitorId -> Map<appName, number[]> for multi-line per-app sparklines
        /* DEBUG_ONLY_BEGIN */ this._debugLogPath  = GLib.build_filenamev([extensionPath, 'debug.log']); /* DEBUG_ONLY_END */
        this._stateFileDir  = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'monish2']);
        this._stateFilePath = GLib.build_filenamev([this._stateFileDir, 'state.json']);

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
            () => this._reloadMonitors(),
        );
        this._jitterChangedId = this._settings.connect(
            `changed::${JITTER_KEY}`,
            () => this._reloadMonitors(),
        );

        // Update stale badges whenever the menu is opened.
        this._menuOpenId = this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen) return;
            this._updateStaleBadges();
        });
    }

    // -----------------------------------------------------------------------
    // Menu construction
    // -----------------------------------------------------------------------

    /**
     * (Re)build the popup menu from the current monitor configuration.
     * Destroys existing menu items and GLib timers first.
     *
     * When debug-logging is enabled, logs the wall time of this call and the
     * per-monitor widget-creation loop to the GNOME journal.  Check with:
     *   journalctl -b --no-pager | grep '\[monish2\]'
     *
     * @param {number} [firstRunDelay=0] - Milliseconds to wait before the first
     *   monitor poll. Pass STARTUP_GRACE_MS on initial build; use 0 for reloads
     *   triggered by settings changes so new values appear immediately.
     */
    _buildMenu(firstRunDelay = 0) {
        /* DEBUG_ONLY_BEGIN */
        const _dbg    = this._settings.get_boolean(DEBUG_LOG_KEY);
        const _tStart = _dbg ? GLib.get_monotonic_time() : 0;
        /* DEBUG_ONLY_END */

        this._stopAllTimers();  // clears _timers and _ageTimers
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
            const empty = new PopupMenu.PopupMenuItem(_('No monitors configured'), {reactive: false});
            this.menu.addMenuItem(empty);
        } else {
            for (const monitor of enabled) {
                this._addMonitorMenuItem(monitor);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
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

        /* DEBUG_ONLY_BEGIN */
        if (_dbg) {
            const ms = Math.round((GLib.get_monotonic_time() - _tStart) / 1000);
            log(`[monish2] _buildMenu(): ${ms} ms, ${enabled.length} enabled monitor(s)`);
        }
        /* DEBUG_ONLY_END */
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

        // Container stacks the base icon and a small status-badge overlay.
        // Using a BinLayout widget (not the icon directly) gives a reliable
        // click target for action monitors on all GNOME Shell versions.
        const iconBox = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class:    `${CSS_PREFIX}-status-icon`,
            y_align:        Clutter.ActorAlign.START,
        });
        // Base icon: big dot for plain monitors, hamburger for action monitors.
        const statusIcon = new St.Icon({
            icon_name: hasActions ? BASE_ICONS.actions : BASE_ICONS.plain,
            icon_size: 16,
        });
        iconBox.add_child(statusIcon);
        const statusIconWidget = iconBox;

        // Name is a button so it receives clicks, changes cursor, and handles hover.
        // x_expand pushes the value and sparkline labels to the right edge of the row.
        const nameLabel = new St.Button({
            label:       monitor.name,
            style_class: `${CSS_PREFIX}-monitor-name`,
            x_align:     Clutter.ActorAlign.START,
            x_expand:    true,
        });
        // On-demand monitors are always underlined so users know the name is clickable.
        if (monitor.onDemand)
            nameLabel.add_style_class_name(`${CSS_PREFIX}-monitor-name-on-demand`);
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

        // Show description as a native tooltip on the name label.
        if (monitor.description) {
            nameLabel.tooltip_text = monitor.description;
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

        // Age / timestamp label for on-demand monitors, shown below the value.
        const ageLabel = new St.Label({
            text:        '',
            style_class: `${CSS_PREFIX}-monitor-age`,
            visible:     false,
        });

        textBox.add_child(headerBox);
        textBox.add_child(mlValueLabel);
        textBox.add_child(mlBox);
        textBox.add_child(ageLabel);
        textBox.add_child(actionsBox);

        item.add_child(statusIconWidget);
        item.add_child(textBox);

        this.menu.addMenuItem(item);
        this._menuItems.set(monitor.id, {item, statusIcon, nameLabel, inlineValueLabel, mlValueLabel, mlBox, sparklineLabel, ageLabel, actionsBox, actionBtns});
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
     * Jitters monitor.intervalSeconds and arms a one-shot GLib timer.
     * Resamples jitter on every call so successive intervals are independent.
     *
     * @param {object} monitor
     */
    _scheduleNextRun(monitor) {
        const jitterPercent = this._settings.get_int(JITTER_KEY);
        const ms       = jitteredInterval(Math.max(1000, monitor.intervalSeconds * 1000), jitterPercent);
        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
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
            /* DEBUG_ONLY_BEGIN */ this._appendDebugLog(monitor, value); /* DEBUG_ONLY_END */
        } catch (e) {
            const errStr = formatError(e);
            this._setMonitorResult(monitor.id, errStr, MonitorStatus.ERROR);
            /* DEBUG_ONLY_BEGIN */ this._appendDebugLog(monitor, `error: ${errStr}`); /* DEBUG_ONLY_END */
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

    /* DEBUG_ONLY_BEGIN */
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
    /* DEBUG_ONLY_END */

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
                    [...this._appHistory].map(([id, perApp]) => [id, Object.fromEntries(perApp)]),
                ),
            });
            GLib.file_set_contents(this._stateFilePath, new TextEncoder().encode(data));
        } catch (_) {}
    }

    /**
     * Restore _results, _history, _appHistory from the state file, then apply
     * the restored results to the menu UI via _applyRestoredState().
     * Called from _buildMenu() after menu items are created.  The async
     * callback is guaranteed to run after _buildMenu() finishes (next event
     * loop tick), so _menuItems is fully populated when the callback executes.
     * On-demand monitors have no polling timer, so applying state here is the
     * only way their last value is visible after a lock/unlock cycle.
     */
    _loadState() {
        const file = Gio.File.new_for_path(this._stateFilePath);
        file.load_contents_async(null, (_, result) => {
            try {
                const [ok, bytes] = file.load_contents_finish(result);
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
                    for (const [id, res] of Object.entries(data.results)) {
                        if (validIds.has(id)) this._results.set(id, res);
                    }
                }
                this._applyRestoredState();
            } catch (_) {}
        });
    }

    /** Restore menu item UI from loaded state (history already populated). */
    _applyRestoredState() {
        for (const [id, {value, status}] of this._results) {
            this._setMonitorResult(id, value, status, {skipHistory: true});
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

        // When restoring state (skipHistory), keep the original collectedAt so the
        // on-demand age label shows the real data age, not "just now" from restore time.
        const collectedAt = skipHistory
            ? (this._results.get(id)?.collectedAt ?? Date.now())
            : Date.now();
        this._results.set(id, {value, status, collectedAt});

        const entry = this._menuItems.get(id);
        if (entry) {
            const monitor = this._monitors.find(m => m.id === id);

            // Clear stale badge immediately when fresh data arrives.
            if (monitor?.onDemand && entry.nameLabel)
                entry.nameLabel.label = monitor.name;

            // Sparklines are meaningless for on-demand monitors (single data point per click).
            const showSpark = !monitor?.onDemand && monitor?.showSparkline !== false;
            const sparkline = showSpark
                ? buildSparklineMarkup(this._history.get(id) ?? [], monitor?.cautionPatterns, monitor?.dangerPatterns)
                : '';
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
                    const spark = showSpark
                        ? buildSparklineMarkup(perApp.get(appName) ?? [], monitor?.cautionPatterns, monitor?.dangerPatterns)
                        : '';
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
                        style_class: `${CSS_PREFIX}-monitor-sparkline`,
                    });
                    lineSpark.get_clutter_text().set_markup(spark);
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
                entry.sparklineLabel.get_clutter_text().set_markup(sparkline);
                entry.mlValueLabel.visible      = false;
                entry.mlValueLabel.text         = '';
                entry.mlBox.visible             = false;
            }

            entry.statusIcon.style = STATUS_COLORS[status] ? `color: ${STATUS_COLORS[status]};` : null;
            const styles = Object.values(MonitorStatus).map(s => `${CSS_PREFIX}-status-${s}`);
            styles.forEach(c => entry.item.remove_style_class_name(c));
            entry.item.add_style_class_name(`${CSS_PREFIX}-status-${status}`);

            // Evaluate each action button's guard with the current value and
            // show/hide accordingly.  Buttons with no guard are always visible.
            for (const {btn, guard} of (entry.actionBtns ?? [])) {
                if (!guard) continue;
                btn.visible = evaluateGuard(guard, value);
            }

            // Age / timestamp label — only for on-demand monitors.
            if (monitor?.onDemand && entry.ageLabel) {
                const timeDisplay = this._settings.get_string(ON_DEMAND_TIME_KEY);
                if (timeDisplay === 'timestamp') {
                    const d = new Date();
                    const hh = String(d.getHours()).padStart(2, '0');
                    const mm = String(d.getMinutes()).padStart(2, '0');
                    const ss = String(d.getSeconds()).padStart(2, '0');
                    entry.ageLabel.text    = `${hh}:${mm}:${ss}`;
                    entry.ageLabel.visible = true;
                } else if (timeDisplay === 'age') {
                    entry.ageLabel.text    = formatAge(0);
                    entry.ageLabel.visible = true;
                    // Cancel any previous age-update timer for this monitor.
                    const prev = this._ageTimers.get(id);
                    if (prev !== undefined) GLib.source_remove(prev);
                    // Refresh label every 30 s until the monitor expires.
                    const ageId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30_000, () => {
                        const res = this._results.get(id);
                        const ageLbl = this._menuItems.get(id)?.ageLabel;
                        if (!res?.collectedAt || !ageLbl) {
                            this._ageTimers.delete(id);
                            return GLib.SOURCE_REMOVE;
                        }
                        ageLbl.text = formatAge(Date.now() - res.collectedAt);
                        return GLib.SOURCE_CONTINUE;
                    });
                    this._ageTimers.set(id, ageId);
                } else {
                    entry.ageLabel.visible = false;
                    entry.ageLabel.text    = '';
                }
            }
        }

        this._saveState();
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
        // Always reset style so a previous colour does not bleed when alerting ends.
        this._errorBadge.style = (alerting && color) ? `color: ${color};` : null;
        // Use as many exclamation marks as there are CAUTION/DANGER monitors
        const alertCount = countAlertStatuses(statuses);
        this._errorBadge.text = alertCount > 0 ? '!'.repeat(alertCount) : '!';
    }

    /**
     * Set or clear the stale badge on every on-demand monitor that has a stored result.
     * Called when the menu opens so the badge reflects the age at the moment the user looks.
     */
    _updateStaleBadges() {
        const now = Date.now();
        for (const monitor of this._monitors) {
            if (!monitor.onDemand) continue;
            const entry = this._menuItems.get(monitor.id);
            if (!entry) continue;
            const res = this._results.get(monitor.id);
            if (!res?.collectedAt) continue;
            const stale = (now - res.collectedAt) >= STALE_THRESHOLD_MS;
            entry.nameLabel.label = monitor.name + (stale ? STALE_BADGE : '');
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
     * Cancel every active GLib timer (scheduled polls and age-label refresh).
     * Must be called before destroying the indicator to avoid orphaned sources.
     */
    _stopAllTimers() {
        for (const sourceId of this._timers.values()) {
            GLib.source_remove(sourceId);
        }
        this._timers.clear();
        for (const sourceId of this._ageTimers.values()) {
            GLib.source_remove(sourceId);
        }
        this._ageTimers.clear();
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
        if (this._menuOpenId) {
            this.menu.disconnect(this._menuOpenId);
            this._menuOpenId = null;
        }
        super.destroy();
    }
});

// ---------------------------------------------------------------------------
// Extension class
// ---------------------------------------------------------------------------

export default class MonishExtension extends Extension {

    enable() {
        this.initTranslations('monish2@thm.link');
        this._settings  = this.getSettings();
        /* DEBUG_ONLY_BEGIN */
        const _dbg    = this._settings.get_boolean(DEBUG_LOG_KEY);
        const _tStart = _dbg ? GLib.get_monotonic_time() : 0;
        /* DEBUG_ONLY_END */
        this._indicator = new MonishIndicator(
            this._settings,
            () => this.openPreferences(),
            this.path,
        );
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        /* DEBUG_ONLY_BEGIN */
        if (_dbg) {
            const ms = Math.round((GLib.get_monotonic_time() - _tStart) / 1000);
            log(`[monish2] enable(): ${ms} ms total, ${this._indicator._monitors.length} monitor(s) configured`);
        }
        /* DEBUG_ONLY_END */
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}
