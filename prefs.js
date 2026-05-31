/**
 * GNOME Shell extension preferences UI (GNOME 45+, libadwaita).
 *
 * Provides an Adw.PreferencesWindow with two sections:
 *   1. "My Monitors" — list of user-configured monitors (add / edit / delete / toggle).
 *   2. "Add Preset"  — one-click addition of common pre-defined monitors.
 *
 * Monitor data is persisted as a JSON string in GSettings key "monitors".
 * All editing is done via a modal Gtk.Dialog to keep the main list clean.
 */

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
    deserializeMonitors,
    serializeMonitors,
    createMonitor,
    validateMonitor,
    MonitorType,
    splitInterval,
    toSeconds,
} from './lib/monitor.js';
import {PRESET_MONITORS} from './lib/presets.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Monitor type labels shown in the Type dropdown (index matches MonitorType values). */
const MONITOR_TYPE_LABELS = ['Shell', 'JavaScript'];
const MONITOR_TYPE_VALUES = [MonitorType.SHELL, MonitorType.JAVASCRIPT];

// ---------------------------------------------------------------------------
// Monitor edit dialog
// ---------------------------------------------------------------------------

/**
 * Build and present a Gtk.Dialog for creating or editing a monitor.
 *
 * @param {Gtk.Window} parent   - Transient parent (the prefs window).
 * @param {object|null} monitor - Existing monitor to edit, or null to create.
 * @param {function(object):void} onSave - Called with the updated monitor object on OK.
 */
function showMonitorEditDialog(parent, monitor, onSave) {
    const isNew = !monitor;
    const data  = monitor
        ? {...monitor}
        : createMonitor();

    const dialog = new Gtk.Dialog({
        title:           isNew ? 'Add Monitor' : 'Edit Monitor',
        transient_for:   parent,
        modal:           true,
        default_width:   520,
        resizable:       false,
    });
    dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
    const saveBtn = dialog.add_button('Save', Gtk.ResponseType.OK);
    saveBtn.add_css_class('suggested-action');

    const content = dialog.get_content_area();
    content.margin_top    = 12;
    content.margin_bottom = 12;
    content.margin_start  = 16;
    content.margin_end    = 16;
    content.spacing       = 8;

    // ---- Name ----
    const nameEntry = new Gtk.Entry({
        placeholder_text: 'e.g. CPU Usage',
        text:             data.name,
        hexpand:          true,
    });
    content.append(labeledRow('Name', nameEntry));

    // ---- Command ----
    const cmdView = new Gtk.TextView({
        wrap_mode:     Gtk.WrapMode.WORD_CHAR,
        hexpand:       true,
        monospace:     true,
        left_margin:   4,
        right_margin:  4,
        top_margin:    4,
        bottom_margin: 4,
    });
    cmdView.get_buffer().set_text(data.command, -1);
    const cmdScroll = new Gtk.ScrolledWindow({
        hexpand:            true,
        min_content_height: 60,
        max_content_height: 120,
    });
    cmdScroll.set_child(cmdView);
    const cmdFrame = new Gtk.Frame();
    cmdFrame.set_child(cmdScroll);
    content.append(labeledRow('Command / Script', cmdFrame));

    // ---- Type ----
    const typeDropDown = new Gtk.DropDown({
        model: Gtk.StringList.new(MONITOR_TYPE_LABELS),
    });
    const typeIdx = MONITOR_TYPE_VALUES.indexOf(data.type ?? MonitorType.SHELL);
    typeDropDown.set_selected(typeIdx >= 0 ? typeIdx : 0);
    content.append(labeledRow('Type', typeDropDown));

    // ---- Interval ----
    // Stored and edited in seconds; upper bound is 86400 (one day).
    const intervalSpin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            value:          data.intervalSeconds,
            lower:          1,
            upper:          86400,
            step_increment: 1,
        }),
        numeric:  true,
        hexpand:  true,
    });
    content.append(labeledRow('Interval (s)', intervalSpin));

    // ---- Output regex ----
    const regexEntry = new Gtk.Entry({
        placeholder_text: 'Optional: capture group 1 used as value',
        text:             data.outputRegex ?? '',
        hexpand:          true,
    });
    content.append(labeledRow('Output Regex', regexEntry));

    // ---- Caution patterns ----
    const cautionEntry = new Gtk.Entry({
        placeholder_text: 'e.g. >70  or  60-80  (comma-separated)',
        text:             (data.cautionPatterns ?? []).join(', '),
        hexpand:          true,
    });
    content.append(labeledRow('Caution Patterns', cautionEntry));

    // ---- Danger patterns ----
    const dangerEntry = new Gtk.Entry({
        placeholder_text: 'e.g. >90  or  critical (comma-separated)',
        text:             (data.dangerPatterns ?? []).join(', '),
        hexpand:          true,
    });
    content.append(labeledRow('Danger Patterns', dangerEntry));

    // ---- On Demand toggle ----
    const onDemandToggle = new Gtk.Switch({
        active: data.onDemand ?? false,
        valign: Gtk.Align.CENTER,
    });
    content.append(labeledRow('On Demand', onDemandToggle));

    // ---- Valid for (seconds) — shown only when On Demand is active ----
    const validSecSpin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            value:          data.onDemandValidSeconds ?? 60,
            lower:          5,
            upper:          3600,
            step_increment: 5,
        }),
        numeric: true,
        hexpand: true,
    });
    const validForRow = labeledRow('Valid for (s)', validSecSpin);
    validForRow.visible = data.onDemand ?? false;
    content.append(validForRow);

    onDemandToggle.connect('notify::active', () => {
        validForRow.visible = onDemandToggle.active;
    });

    // ---- Error label ----
    const errorLabel = new Gtk.Label({
        label:     '',
        xalign:    0,
        wrap:      true,
        visible:   false,
    });
    errorLabel.add_css_class('error');
    content.append(errorLabel);

    // ---- Response handler ----
    dialog.connect('response', (_d, response) => {
        if (response === Gtk.ResponseType.OK) {
            const buf = cmdView.get_buffer();
            const cmd = buf.get_text(buf.get_start_iter(), buf.get_end_iter(), false).trim();

            const totalSec = toSeconds(intervalSpin.get_value_as_int(), 'seconds');

            const updated = {
                ...data,
                name:                 nameEntry.get_text().trim(),
                command:              cmd,
                type:                 MONITOR_TYPE_VALUES[typeDropDown.get_selected()] ?? MonitorType.SHELL,
                intervalSeconds:      totalSec,
                outputRegex:          regexEntry.get_text().trim(),
                cautionPatterns:      splitPatterns(cautionEntry.get_text()),
                dangerPatterns:       splitPatterns(dangerEntry.get_text()),
                onDemand:             onDemandToggle.active,
                onDemandValidSeconds: validSecSpin.get_value_as_int(),
            };

            const errors = validateMonitor(updated);
            if (errors.length > 0) {
                errorLabel.label   = errors.join('\n');
                errorLabel.visible = true;
                return; // keep dialog open
            }

            onSave(updated);
        }
        dialog.destroy();
    });

    dialog.present();
}

// ---------------------------------------------------------------------------
// Preferences window
// ---------------------------------------------------------------------------

export default class MonishPreferences extends ExtensionPreferences {

    /**
     * Fill the preferences window provided by GNOME Shell.
     * Adds a single page with monitor list and preset list groups.
     *
     * @param {Adw.PreferencesWindow} window
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title:     'Monitors',
            icon_name: 'utilities-system-monitor-symbolic',
        });
        window.add(page);

        // ---- My Monitors group ----
        const monitorsGroup = new Adw.PreferencesGroup({
            title:       'My Monitors',
            description: 'Monitors are executed on their configured interval.',
        });
        page.add(monitorsGroup);

        // Add Monitor button is added first so it is always pinned to the top
        // of the group regardless of whether the list is empty or populated.
        // (buildMonitorRows appends rows after it; refresh removes/re-appends
        // those rows, leaving addRow permanently at position 0.)
        const addRow = new Adw.ButtonRow({title: 'Add Monitor'});
        addRow.add_css_class('suggested-action');
        monitorsGroup.add(addRow);

        // refreshAll is set after both refresh functions are defined so that
        // arrow-function closures can capture it by reference.
        let refreshAll;

        // Track rows built by buildMonitorRows so refreshMonitorRows can
        // remove exactly those rows without touching libadwaita's internal
        // group children (which would cause an infinite removal loop).
        let builtRows = buildMonitorRows(monitorsGroup, settings, window, () => refreshAll());

        const refreshMonitorRows = () => {
            builtRows.forEach(row => monitorsGroup.remove(row));
            builtRows = buildMonitorRows(monitorsGroup, settings, window, () => refreshAll());
        };

        addRow.connect('activated', () => {
            showMonitorEditDialog(window, null, (newMonitor) => {
                const monitors = deserializeMonitors(settings.get_string('monitors'));
                monitors.push(newMonitor);
                settings.set_string('monitors', serializeMonitors(monitors));
                refreshAll();
            });
        });

        // ---- Presets group ----
        const presetsGroup = new Adw.PreferencesGroup({
            title:       'Add Preset',
            description: 'Click a preset to add it to your monitor list.',
        });
        page.add(presetsGroup);

        let builtPresetRows = buildPresetRows(presetsGroup, settings, () => refreshAll());

        const refreshPresetRows = () => {
            builtPresetRows.forEach(row => presetsGroup.remove(row));
            builtPresetRows = buildPresetRows(presetsGroup, settings, () => refreshAll());
        };

        refreshAll = () => {
            refreshMonitorRows();
            refreshPresetRows();
        };

        // ---- Schedule Settings group ----
        const scheduleGroup = new Adw.PreferencesGroup({
            title:       'Schedule Settings',
            description: 'Applied globally to all scheduled monitors.',
        });
        page.add(scheduleGroup);

        const jitterRow = new Adw.ActionRow({
            title:    'Schedule Jitter (%)',
            subtitle: 'Random ±% offset on each poll interval — set to 0 for exact timing',
        });
        const jitterSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                value:          0,
                lower:          0,
                upper:          50,
                step_increment: 1,
            }),
            numeric: true,
            valign:  Gtk.Align.CENTER,
        });
        // Connect before set_value so the handler is registered before the
        // first value-changed fires, guaranteeing the stored setting is written.
        jitterSpin.connect('value-changed', () => {
            settings.set_int('jitter-percent', jitterSpin.get_value_as_int());
        });
        jitterSpin.set_value(settings.get_int('jitter-percent'));
        jitterRow.add_suffix(jitterSpin);
        scheduleGroup.add(jitterRow);

        // ---- Debug logging toggle ----
        const debugRow = new Adw.ActionRow({
            title:    'Debug Logging',
            subtitle: 'Log each command execution to debug.log in the extension directory',
        });
        const debugToggle = new Gtk.Switch({
            active: settings.get_boolean('debug-logging'),
            valign: Gtk.Align.CENTER,
        });
        debugToggle.connect('notify::active', () => {
            settings.set_boolean('debug-logging', debugToggle.active);
        });
        debugRow.add_suffix(debugToggle);
        scheduleGroup.add(debugRow);

        // ---- View log button ----
        const logRow = new Adw.ActionRow({
            title:    'Debug Log',
            subtitle: 'View the debug log file',
        });
        const viewLogBtn = new Gtk.Button({
            label:       'View Log',
            valign:      Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        const logPath = GLib.build_filenamev([this.path, 'debug.log']);
        viewLogBtn.connect('clicked', () => {
            showDebugLogWindow(window, logPath);
        });
        logRow.add_suffix(viewLogBtn);
        scheduleGroup.add(logRow);
    }
}

// ---------------------------------------------------------------------------
// Debug log viewer
// ---------------------------------------------------------------------------

/**
 * Open a non-modal window showing the contents of the debug log file.
 * A "Clear Log" button in the header bar truncates the file.
 *
 * @param {Gtk.Window} parent  - Transient parent (the prefs window).
 * @param {string}     logPath - Absolute path to the debug log file.
 */
function showDebugLogWindow(parent, logPath) {
    const [ok, bytes] = GLib.file_get_contents(logPath);
    const content = ok ? new TextDecoder().decode(bytes) : '(no log entries yet)';

    const view = new Gtk.TextView({
        editable:      false,
        monospace:     true,
        left_margin:   8,
        right_margin:  8,
        top_margin:    8,
        bottom_margin: 8,
    });
    view.get_buffer().set_text(content, -1);

    const scroll = new Gtk.ScrolledWindow({vexpand: true, hexpand: true});
    scroll.set_child(view);

    const clearBtn = new Gtk.Button({
        label:       'Clear Log',
        css_classes: ['destructive-action'],
    });
    clearBtn.connect('clicked', () => {
        try {
            // Truncate the file by opening it for writing without writing anything.
            Gio.File.new_for_path(logPath)
                .replace(null, false, Gio.FileCreateFlags.NONE, null)
                .close(null);
        } catch (_) {}
        view.get_buffer().set_text('', -1);
    });

    const headerBar = new Adw.HeaderBar();
    headerBar.pack_start(clearBtn);

    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(scroll);

    const win = new Adw.Window({
        title:          'Debug Log',
        transient_for:  parent,
        modal:          false,
        default_width:  720,
        default_height: 500,
    });
    win.set_content(toolbarView);
    win.present();
}

// ---------------------------------------------------------------------------
// Helper: build monitor rows
// ---------------------------------------------------------------------------

/**
 * Populate a PreferencesGroup with one ActionRow per monitor.
 * Rows include Edit and Delete buttons.
 *
 * Returns the array of widgets added so callers can remove exactly those
 * rows later without touching libadwaita's internal group children.
 *
 * @param {Adw.PreferencesGroup} group
 * @param {Gio.Settings} settings
 * @param {Gtk.Window} parentWindow
 * @param {function():void} refresh - Called after any mutation.
 * @returns {Gtk.Widget[]} The rows added to group.
 */
function buildMonitorRows(group, settings, parentWindow, refresh) {
    const monitors = deserializeMonitors(settings.get_string('monitors'));
    const added = [];

    if (monitors.length === 0) {
        const emptyRow = new Adw.ActionRow({
            title:     'No monitors yet',
            subtitle:  'Use "Add Monitor" or a preset below.',
            sensitive: false,
        });
        group.add(emptyRow);
        added.push(emptyRow);
        return added;
    }

    for (let i = 0; i < monitors.length; i++) {
        const monitor = monitors[i];
        const isFirst = i === 0;
        const isLast  = i === monitors.length - 1;

        const {magnitude, unit} = splitInterval(monitor.intervalSeconds);
        const unitLabel = magnitude === 1 ? unit.slice(0, -1) : unit;
        const row = new Adw.ActionRow({
            title:    monitor.name,
            subtitle: `every ${magnitude} ${unitLabel} — ${monitor.command.slice(0, 60)}${monitor.command.length > 60 ? '…' : ''}`,
        });

        // Enable/disable toggle
        const toggle = new Gtk.Switch({
            active: monitor.enabled,
            valign: Gtk.Align.CENTER,
        });
        toggle.connect('notify::active', () => {
            mutateMonitor(settings, monitor.id, m => ({...m, enabled: toggle.active}));
        });

        // Move-up button — disabled for the first row
        const upBtn = new Gtk.Button({
            icon_name:    'go-up-symbolic',
            valign:       Gtk.Align.CENTER,
            css_classes:  ['flat'],
            tooltip_text: 'Move up',
            sensitive:    !isFirst,
        });
        upBtn.connect('clicked', () => {
            const all = deserializeMonitors(settings.get_string('monitors'));
            const idx  = all.findIndex(m => m.id === monitor.id);
            if (idx > 0) {
                [all[idx - 1], all[idx]] = [all[idx], all[idx - 1]];
                settings.set_string('monitors', serializeMonitors(all));
                refresh();
            }
        });

        // Move-down button — disabled for the last row
        const downBtn = new Gtk.Button({
            icon_name:    'go-down-symbolic',
            valign:       Gtk.Align.CENTER,
            css_classes:  ['flat'],
            tooltip_text: 'Move down',
            sensitive:    !isLast,
        });
        downBtn.connect('clicked', () => {
            const all = deserializeMonitors(settings.get_string('monitors'));
            const idx  = all.findIndex(m => m.id === monitor.id);
            if (idx < all.length - 1) {
                [all[idx], all[idx + 1]] = [all[idx + 1], all[idx]];
                settings.set_string('monitors', serializeMonitors(all));
                refresh();
            }
        });

        // Edit button
        const editBtn = new Gtk.Button({
            icon_name:   'document-edit-symbolic',
            valign:      Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Edit',
        });
        editBtn.connect('clicked', () => {
            showMonitorEditDialog(parentWindow, monitor, (updated) => {
                mutateMonitor(settings, monitor.id, () => updated);
                refresh();
            });
        });

        // Duplicate button — inserts a copy immediately after this row
        const dupBtn = new Gtk.Button({
            icon_name:   'edit-copy-symbolic',
            valign:      Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Duplicate',
        });
        dupBtn.connect('clicked', () => {
            const all = deserializeMonitors(settings.get_string('monitors'));
            const idx  = all.findIndex(m => m.id === monitor.id);
            // Exclude id from the spread so createMonitor() assigns a fresh one.
            const {id: _id, ...rest} = monitor;
            const copy = createMonitor({...rest, name: `${monitor.name} Copy`});
            all.splice(idx + 1, 0, copy);
            settings.set_string('monitors', serializeMonitors(all));
            refresh();
        });

        // Delete button
        const delBtn = new Gtk.Button({
            icon_name:   'user-trash-symbolic',
            valign:      Gtk.Align.CENTER,
            css_classes: ['flat', 'destructive-action'],
            tooltip_text: 'Delete',
        });
        delBtn.connect('clicked', () => {
            const all = deserializeMonitors(settings.get_string('monitors'));
            settings.set_string('monitors', serializeMonitors(all.filter(m => m.id !== monitor.id)));
            refresh();
        });

        row.add_suffix(toggle);
        row.add_suffix(upBtn);
        row.add_suffix(downBtn);
        row.add_suffix(editBtn);
        row.add_suffix(dupBtn);
        row.add_suffix(delBtn);
        group.add(row);
        added.push(row);
    }

    return added;
}

// ---------------------------------------------------------------------------
// Helper: build preset rows
// ---------------------------------------------------------------------------

/**
 * Populate a PreferencesGroup with one ActionRow per preset that has not yet
 * been added to the monitor list (matched by name).
 *
 * Returns the array of widgets added so callers can remove them on refresh.
 *
 * @param {Adw.PreferencesGroup} group
 * @param {Gio.Settings} settings
 * @param {function():void} refresh - Called after a preset is added.
 * @returns {Gtk.Widget[]} The rows added to group.
 */
function buildPresetRows(group, settings, refresh) {
    const monitors   = deserializeMonitors(settings.get_string('monitors'));
    const addedNames = new Set(monitors.map(m => m.name));
    const added      = [];

    for (const preset of PRESET_MONITORS) {
        if (addedNames.has(preset.name)) continue;

        const row = new Adw.ActionRow({
            title:    preset.name,
            subtitle: summarisePreset(preset),
        });
        const addBtn = new Gtk.Button({
            icon_name:    'list-add-symbolic',
            valign:       Gtk.Align.CENTER,
            css_classes:  ['flat'],
            tooltip_text: 'Add to my monitors',
        });
        addBtn.connect('clicked', () => {
            const current = deserializeMonitors(settings.get_string('monitors'));
            current.push(createMonitor(preset));
            settings.set_string('monitors', serializeMonitors(current));
            refresh();
        });
        row.add_suffix(addBtn);
        row.activatable_widget = addBtn;
        group.add(row);
        added.push(row);
    }

    if (added.length === 0) {
        const emptyRow = new Adw.ActionRow({
            title:     'All presets added',
            subtitle:  'Every available preset is already in your monitors.',
            sensitive: false,
        });
        group.add(emptyRow);
        added.push(emptyRow);
    }

    return added;
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
 * Apply a transform function to one monitor in GSettings by id.
 *
 * @param {Gio.Settings} settings
 * @param {string} id           - Monitor id to update.
 * @param {function(object):object} fn - Transform function.
 */
function mutateMonitor(settings, id, fn) {
    const monitors = deserializeMonitors(settings.get_string('monitors'));
    const updated  = monitors.map(m => m.id === id ? fn(m) : m);
    settings.set_string('monitors', serializeMonitors(updated));
}

/**
 * Build a two-column row (label on left, widget on right) for the edit dialog.
 *
 * @param {string} labelText
 * @param {Gtk.Widget} widget
 * @returns {Gtk.Box}
 */
function labeledRow(labelText, widget) {
    const box = new Gtk.Box({spacing: 12, hexpand: true});
    const lbl = new Gtk.Label({
        label:  labelText,
        xalign: 0,
        width_chars: 16,
    });
    box.append(lbl);
    box.append(widget);
    return box;
}

/**
 * Split a comma-separated pattern string into a trimmed array.
 *
 * @param {string} raw
 * @returns {string[]}
 */
function splitPatterns(raw) {
    return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Build a subtitle string for a preset row.
 * Leads with the preset's human-readable description (if present), then
 * appends the interval and any configured thresholds.
 *
 * @param {object} preset
 * @returns {string}
 */
function summarisePreset(preset) {
    const {magnitude, unit} = splitInterval(preset.intervalSeconds);
    const unitLabel = magnitude === 1 ? unit.slice(0, -1) : unit;
    const meta = [`every ${magnitude} ${unitLabel}`];
    if (preset.cautionPatterns?.length > 0) meta.push(`caution: ${preset.cautionPatterns[0]}`);
    if (preset.dangerPatterns?.length  > 0) meta.push(`danger: ${preset.dangerPatterns[0]}`);
    const metaStr = meta.join(' · ');
    return preset.description ? `${preset.description}\n${metaStr}` : metaStr;
}
