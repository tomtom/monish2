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

const _ = (str) => GLib.dgettext('monish2@thm.link', str);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Monitor type labels shown in the Type dropdown (index matches MonitorType values). */
const MONITOR_TYPE_LABELS = [_('Shell'), _('JavaScript')];
const MONITOR_TYPE_VALUES = [MonitorType.SHELL, MonitorType.JAVASCRIPT];

/**
 * Directories scanned for additional preset definition files (JSON).
 * System-wide first, then the user-specific XDG data directory.
 * Built-in presets always win over external ones on name collision.
 */
const EXTERNAL_PRESET_DIRS = [
    '/usr/share/monish',
    GLib.build_filenamev([GLib.get_user_data_dir(), 'monish']),
];

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
    // Deep-copy mutable fields so edits don't affect the caller's object if
    // the dialog is cancelled.  Action objects are spread individually so that
    // the changed-event handlers in buildActionRow mutate the copy, not the
    // original monitor's actions (which would persist even after Cancel).
    const data  = monitor
        ? {
            ...monitor,
            args:      [...(monitor.args ?? [])],
            argValues: {...(monitor.argValues ?? {})},
            actions:   (monitor.actions ?? []).map(a => ({...a})),
        }
        : createMonitor();

    const dialog = new Gtk.Dialog({
        title:           isNew ? _('Add Monitor') : _('Edit Monitor'),
        transient_for:   parent,
        modal:           true,
        default_width:   520,
        resizable:       false,
    });
    dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
    const saveBtn = dialog.add_button(_('Save'), Gtk.ResponseType.OK);
    saveBtn.add_css_class('suggested-action');

    // Wrap the content in a ScrolledWindow so the dialog height is capped even
    // for monitors with many actions.  Without this, the error label at the
    // bottom of the content area is invisible when the dialog overflows the screen.
    const contentScroll = new Gtk.ScrolledWindow({
        hscrollbar_policy:        Gtk.PolicyType.NEVER,
        vscrollbar_policy:        Gtk.PolicyType.AUTOMATIC,
        propagate_natural_height: true,
        max_content_height:       640,
    });
    const content = new Gtk.Box({
        orientation:   Gtk.Orientation.VERTICAL,
        spacing:       8,
        margin_top:    12,
        margin_bottom: 12,
        margin_start:  16,
        margin_end:    16,
    });
    contentScroll.set_child(content);
    dialog.get_content_area().append(contentScroll);

    // ---- Name ----
    const nameEntry = new Gtk.Entry({
        placeholder_text: _('e.g. CPU Usage'),
        text:             data.name,
        hexpand:          true,
    });
    content.append(labeledRow(_('Name'), nameEntry));

    // ---- Description ----
    const descEntry = new Gtk.Entry({
        placeholder_text: _('Optional: what this monitor measures'),
        text:             data.description ?? '',
        hexpand:          true,
    });
    content.append(labeledRow('Description', descEntry));

    // ---- Setup link (only for monitors that ship setup instructions) ----
    if (data.helpText) {
        const helpBtn = new Gtk.Button({
            label:       _('Setup instructions…'),
            css_classes: ['caption', 'flat'],
            halign:      Gtk.Align.START,
        });
        helpBtn.connect('clicked', () => showHelpDialog(dialog, data.helpText));
        content.append(helpBtn);
    }

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
    cmdView.get_buffer().set_text(data.command ?? '', -1);
    const cmdScroll = new Gtk.ScrolledWindow({
        hexpand:            true,
        min_content_height: 60,
        max_content_height: 120,
    });
    cmdScroll.set_child(cmdView);
    const cmdFrame = new Gtk.Frame();
    cmdFrame.set_child(cmdScroll);
    content.append(labeledRow(_('Command / Script'), cmdFrame));

    // ---- Type ----
    const typeDropDown = new Gtk.DropDown({
        model: Gtk.StringList.new(MONITOR_TYPE_LABELS),
    });
    const typeIdx = MONITOR_TYPE_VALUES.indexOf(data.type ?? MonitorType.SHELL);
    typeDropDown.set_selected(typeIdx >= 0 ? typeIdx : 0);
    content.append(labeledRow(_('Type'), typeDropDown));

    // ---- Arguments ----
    const argsHeaderBox = new Gtk.Box({spacing: 8, hexpand: true});
    const argsTitle = new Gtk.Label({
        label:       _('Arguments'),
        xalign:      0,
        hexpand:     true,
        css_classes: ['heading'],
    });
    const addArgBtn = new Gtk.Button({
        label:       _('+ Add'),
        css_classes: ['flat'],
        valign:      Gtk.Align.CENTER,
    });
    argsHeaderBox.append(argsTitle);
    argsHeaderBox.append(addArgBtn);
    content.append(argsHeaderBox);

    const argsHint = new Gtk.Label({
        label:       _('JS: injected as const NAME = value  ·  Shell: injected as export NAME=value'),
        xalign:      0,
        wrap:        true,
        css_classes: ['caption', 'dim-label'],
    });
    content.append(argsHint);

    // Vertical container for live arg rows
    const argsListBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing:     4,
    });
    content.append(argsListBox);

    // Per-row label references updated when the type dropdown changes
    let argRowRefs = [];

    /** Return tooltip text for an argument, based on the currently selected type. */
    function currentArgTooltip(argName) {
        const type = MONITOR_TYPE_VALUES[typeDropDown.get_selected()] ?? MonitorType.SHELL;
        return type === MonitorType.JAVASCRIPT
            ? `In your script: const ${argName} = "value";  (auto-injected)`
            : `In your command: $${argName}  (injected as environment variable)`;
    }

    /** Build one arg row widget; also registers its label in argRowRefs. */
    function buildArgRow(arg) {
        const row = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing:     8,
            hexpand:     true,
        });
        const lbl = new Gtk.Label({
            label:        arg.label || arg.name,
            xalign:       0,
            width_chars:  14,
            tooltip_text: currentArgTooltip(arg.name),
        });
        const valueEntry = new Gtk.Entry({
            text:             (data.argValues ?? {})[arg.name] ?? '',
            hexpand:          true,
            placeholder_text: _('value'),
        });
        valueEntry.connect('changed', () => {
            if (!data.argValues) data.argValues = {};
            data.argValues[arg.name] = valueEntry.get_text();
        });
        const delBtn = new Gtk.Button({
            icon_name:   'user-trash-symbolic',
            css_classes: ['flat'],
            valign:      Gtk.Align.CENTER,
        });
        delBtn.connect('clicked', () => {
            data.args = (data.args ?? []).filter(a => a.name !== arg.name);
            if (data.argValues) delete data.argValues[arg.name];
            rebuildArgRows();
        });
        row.append(lbl);
        row.append(valueEntry);
        row.append(delBtn);
        argRowRefs.push({lbl, arg});
        return row;
    }

    /** Remove and recreate all arg rows from data.args. */
    function rebuildArgRows() {
        let child = argsListBox.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            argsListBox.remove(child);
            child = next;
        }
        argRowRefs = [];
        for (const arg of (data.args ?? [])) {
            argsListBox.append(buildArgRow(arg));
        }
    }

    rebuildArgRows();

    // Refresh tooltips whenever the type selection changes
    typeDropDown.connect('notify::selected', () => {
        for (const {lbl, arg} of argRowRefs) {
            lbl.tooltip_text = currentArgTooltip(arg.name);
        }
    });

    // "Add Argument" — opens a small modal dialog for name + label
    addArgBtn.connect('clicked', () => {
        const addDlg = new Gtk.Dialog({
            title:         _('Add Argument'),
            transient_for: parent,
            modal:         true,
            default_width: 360,
            resizable:     false,
        });
        addDlg.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        addDlg.add_button(_('Add'), Gtk.ResponseType.OK).add_css_class('suggested-action');

        const dlgContent = addDlg.get_content_area();
        dlgContent.margin_top    = 12;
        dlgContent.margin_bottom = 12;
        dlgContent.margin_start  = 16;
        dlgContent.margin_end    = 16;
        dlgContent.spacing       = 8;

        const argNameEntry = new Gtk.Entry({
            placeholder_text: _('Identifier, e.g. EXCLUDE (no spaces)'),
            hexpand:          true,
        });
        const argLabelEntry = new Gtk.Entry({
            placeholder_text: _('Display label, e.g. Exclude processes'),
            hexpand:          true,
        });
        dlgContent.append(labeledRow(_('Name'), argNameEntry));
        dlgContent.append(labeledRow(_('Label'), argLabelEntry));

        addDlg.connect('response', (_d, resp) => {
            if (resp === Gtk.ResponseType.OK) {
                // Normalise to valid identifier: uppercase, spaces → underscores,
                // strip anything that isn't alphanumeric or underscore.
                const rawName = argNameEntry.get_text().trim()
                    .toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
                if (rawName && !(data.args ?? []).find(a => a.name === rawName)) {
                    if (!data.args) data.args = [];
                    if (!data.argValues) data.argValues = {};
                    data.args.push({
                        name:  rawName,
                        label: argLabelEntry.get_text().trim() || rawName,
                    });
                    data.argValues[rawName] = '';
                    rebuildArgRows();
                }
            }
            addDlg.destroy();
        });
        addDlg.present();
    });

    // ---- Actions ----
    const actionsHeaderBox = new Gtk.Box({spacing: 8, hexpand: true});
    const actionsTitle = new Gtk.Label({
        label:       _('Actions'),
        xalign:      0,
        hexpand:     true,
        css_classes: ['heading'],
    });
    const addActionBtn = new Gtk.Button({
        label:       _('+ Add'),
        css_classes: ['flat'],
        valign:      Gtk.Align.CENTER,
    });
    actionsHeaderBox.append(actionsTitle);
    actionsHeaderBox.append(addActionBtn);
    content.append(actionsHeaderBox);

    const actionsHint = new Gtk.Label({
        label:       _('Commands run on demand from the monitor icon in the menu.'),
        xalign:      0,
        wrap:        true,
        css_classes: ['caption', 'dim-label'],
    });
    content.append(actionsHint);

    const actionsListBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing:     4,
    });
    content.append(actionsListBox);

    /** Build one action row: label entry + command entry + type dropdown + delete. */
    function buildActionRow(action) {
        const row = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing:     4,
            hexpand:     true,
        });

        const topRow = new Gtk.Box({spacing: 8, hexpand: true});
        const labelEntry = new Gtk.Entry({
            text:             action.label ?? '',
            placeholder_text: _('Action label'),
            hexpand:          true,
        });
        labelEntry.connect('changed', () => {
            action.label = labelEntry.get_text();
        });

        const actionTypeDropDown = new Gtk.DropDown({
            model: Gtk.StringList.new(MONITOR_TYPE_LABELS),
        });
        const actionTypeIdx = MONITOR_TYPE_VALUES.indexOf(action.type ?? MonitorType.SHELL);
        actionTypeDropDown.set_selected(actionTypeIdx >= 0 ? actionTypeIdx : 0);
        actionTypeDropDown.connect('notify::selected', () => {
            action.type = MONITOR_TYPE_VALUES[actionTypeDropDown.get_selected()] ?? MonitorType.SHELL;
        });

        const delBtn = new Gtk.Button({
            icon_name:   'user-trash-symbolic',
            css_classes: ['flat'],
            valign:      Gtk.Align.CENTER,
        });
        delBtn.connect('clicked', () => {
            data.actions = (data.actions ?? []).filter(a => a !== action);
            rebuildActionRows();
        });

        topRow.append(labelEntry);
        topRow.append(actionTypeDropDown);
        topRow.append(delBtn);

        const cmdEntry = new Gtk.Entry({
            text:             action.command ?? '',
            placeholder_text: _('Command or script'),
            hexpand:          true,
            css_classes:      ['monospace'],
        });
        cmdEntry.connect('changed', () => {
            action.command = cmdEntry.get_text();
        });

        // Optional JS condition evaluated against the current monitor value.
        // Empty = always show the button.
        const guardEntry = new Gtk.Entry({
            text:             action.guard ?? '',
            placeholder_text: _("JS condition on value (e.g. value === 'disabled')"),
            hexpand:          true,
            css_classes:      ['monospace'],
        });
        guardEntry.connect('changed', () => {
            action.guard = guardEntry.get_text();
        });

        row.append(topRow);
        row.append(cmdEntry);
        row.append(guardEntry);
        return row;
    }

    /** Remove and recreate all action rows from data.actions. */
    function rebuildActionRows() {
        let child = actionsListBox.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            actionsListBox.remove(child);
            child = next;
        }
        for (const action of (data.actions ?? [])) {
            actionsListBox.append(buildActionRow(action));
        }
    }

    rebuildActionRows();

    addActionBtn.connect('clicked', () => {
        if (!data.actions) data.actions = [];
        data.actions.push({label: '', command: '', type: MonitorType.SHELL});
        rebuildActionRows();
    });

    // ---- Interval (s) ----
    // Stored and edited in seconds; 0 = on-demand (no timer, click name to refresh); upper bound is 86400 (one day).
    // Initialise adjustment at lower bound first, then call set_value() so
    // GTK clamps correctly — a GJS GObject init-ordering issue leaves the
    // value unclamped when value is set before lower in the constructor.
    const intervalSpin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            value:          0,
            lower:          0,
            upper:          86400,
            step_increment: 1,
        }),
        numeric:  true,
        hexpand:  true,
    });
    intervalSpin.set_value(data.intervalSeconds);
    content.append(labeledRow(_('Interval (s)'), intervalSpin));

    const intervalHint = new Gtk.Label({
        label:       _('Set to 0 for on-demand (click the monitor name to refresh manually).'),
        xalign:      0,
        wrap:        true,
        css_classes: ['caption', 'dim-label'],
    });
    content.append(intervalHint);

    // ---- Output regex ----
    const regexEntry = new Gtk.Entry({
        placeholder_text: _('Optional: capture group 1 used as value'),
        text:             data.outputRegex ?? '',
        hexpand:          true,
    });
    content.append(labeledRow(_('Output Regex'), regexEntry));

    // ---- Caution patterns ----
    const cautionEntry = new Gtk.Entry({
        placeholder_text: _('e.g. >70  or  60-80  (comma-separated)'),
        text:             (data.cautionPatterns ?? []).join(', '),
        hexpand:          true,
    });
    content.append(labeledRow(_('Caution Patterns'), cautionEntry));

    // ---- Danger patterns ----
    const dangerEntry = new Gtk.Entry({
        placeholder_text: _('e.g. >90  or  critical (comma-separated)'),
        text:             (data.dangerPatterns ?? []).join(', '),
        hexpand:          true,
    });
    content.append(labeledRow(_('Danger Patterns'), dangerEntry));

    // ---- Show Sparkline toggle ----
    const sparklineSwitch = new Gtk.Switch({
        active: data.showSparkline !== false,
        valign: Gtk.Align.CENTER,
    });
    content.append(labeledRow(_('Show Sparkline'), sparklineSwitch));

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
                name:               nameEntry.get_text().trim(),
                description:        descEntry.get_text().trim(),
                command:            cmd,
                type:               MONITOR_TYPE_VALUES[typeDropDown.get_selected()] ?? MonitorType.SHELL,
                intervalSeconds:    totalSec,
                intervalExpression: '',
                outputRegex:        regexEntry.get_text().trim(),
                cautionPatterns:    splitPatterns(cautionEntry.get_text()),
                dangerPatterns:     splitPatterns(dangerEntry.get_text()),
                onDemand:           totalSec === 0,
                actions:            data.actions ?? [],
                showSparkline:      sparklineSwitch.active,
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
// Export / Import
// ---------------------------------------------------------------------------

/**
 * Open a save-file dialog and write the current monitor list as pretty-printed
 * JSON to the chosen file.
 *
 * @param {Gio.Settings} settings
 * @param {Gtk.Window}   parent
 */
function showExportDialog(settings, parent) {
    const dialog = new Gtk.FileDialog({
        title:        _('Export Monitors'),
        initial_name: 'monitors.json',
    });
    dialog.save(parent, null, (_src, result) => {
        try {
            const file = dialog.save_finish(result);
            const monitors = deserializeMonitors(settings.get_string('monitors'));
            const json = JSON.stringify({version: 1, monitors}, null, 2);
            file.replace_contents(
                new TextEncoder().encode(json),
                null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null,
            );
        } catch (_) { /* user cancelled or write error — silently ignore */ }
    });
}

/**
 * Open a file-chooser dialog, parse the selected JSON file as a monitor array,
 * and ask whether to append to or replace the current monitors.
 *
 * @param {Gio.Settings} settings
 * @param {Gtk.Window}   parent
 * @param {function():void} refresh - Called after monitors are updated.
 */
function showImportDialog(settings, parent, refresh) {
    const openDialog = new Gtk.FileDialog({title: _('Import Monitors')});
    openDialog.open(parent, null, (_src, result) => {
        let parsed;
        try {
            const file    = openDialog.open_finish(result);
            const [, bytes] = GLib.file_get_contents(file.get_path());
            parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch (_) {
            return; // user cancelled or unreadable / invalid JSON
        }

        // Accept both legacy bare array and versioned envelope {version, monitors}.
        const monitorsRaw = Array.isArray(parsed) ? parsed
            : (parsed?.version && Array.isArray(parsed.monitors)) ? parsed.monitors
            : null;
        if (!monitorsRaw) return;
        // Assign fresh IDs so imported monitors never collide with existing ones.
        const imported = monitorsRaw
            .filter(m => m.name && m.command)
            .map(m => createMonitor({...m}));
        if (imported.length === 0) return;

        // Ask the user whether to append or replace.
        const askDlg = new Gtk.Dialog({
            title:         _('Import Monitors'),
            transient_for: parent,
            modal:         true,
        });
        const RESP_APPEND  = 1;
        const RESP_REPLACE = 2;
        askDlg.add_button(_('Cancel'),      Gtk.ResponseType.CANCEL);
        askDlg.add_button(_('Append'),      RESP_APPEND).add_css_class('suggested-action');
        askDlg.add_button(_('Replace All'), RESP_REPLACE);

        const lbl = new Gtk.Label({
            label:         `Found ${imported.length} monitor(s). Add to existing or replace all?`,
            wrap:          true,
            xalign:        0,
            margin_top:    12,
            margin_bottom: 12,
            margin_start:  16,
            margin_end:    16,
        });
        askDlg.get_content_area().append(lbl);

        askDlg.connect('response', (_d, resp) => {
            if (resp === RESP_APPEND) {
                const current = deserializeMonitors(settings.get_string('monitors'));
                settings.set_string('monitors', serializeMonitors([...current, ...imported]));
                refresh();
            } else if (resp === RESP_REPLACE) {
                settings.set_string('monitors', serializeMonitors(imported));
                refresh();
            }
            askDlg.destroy();
        });
        askDlg.present();
    });
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
        this.initTranslations('monish2@thm.link');
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title:     _('Monitors'),
            icon_name: 'utilities-system-monitor-symbolic',
        });
        window.add(page);

        // ---- My Monitors group ----
        const monitorsGroup = new Adw.PreferencesGroup({
            title:       _('My Monitors'),
            description: _('Monitors are executed on their configured interval.'),
        });
        page.add(monitorsGroup);

        // Three action buttons (Add / Export / Import) displayed side by side
        // in a single row so they don't each occupy a full-height list row.
        const addRow = new Adw.PreferencesRow({activatable: false, focusable: false});
        const actionsBox = new Gtk.Box({
            orientation:  Gtk.Orientation.HORIZONTAL,
            spacing:      8,
            homogeneous:  true,
            margin_top:   8,
            margin_bottom: 8,
            margin_start:  12,
            margin_end:    12,
        });

        const addBtn = new Gtk.Button({label: _('+ Add'), css_classes: ['suggested-action']});
        const exportBtn = new Gtk.Button({label: _('Export Monitors')});
        const importBtn = new Gtk.Button({label: _('Import Monitors')});

        actionsBox.append(addBtn);
        actionsBox.append(exportBtn);
        actionsBox.append(importBtn);
        addRow.set_child(actionsBox);
        monitorsGroup.add(addRow);

        exportBtn.connect('clicked', () => showExportDialog(settings, window));
        importBtn.connect('clicked', () => showImportDialog(settings, window, () => refreshAll()));

        // refreshAll is set after both refresh functions are defined so that
        // arrow-function closures can capture it by reference.
        let refreshAll;

        // Track rows built by buildMonitorRows so refreshMonitorRows can
        // remove exactly those rows without touching libadwaita's internal
        // group children (which would cause an infinite removal loop).
        let builtRows = buildMonitorRows(monitorsGroup, settings, window, (fId, scrollToFocused) => refreshAll(fId, scrollToFocused));

        const refreshMonitorRows = (focusId, scrollToFocused = false) => {
            // Save scroll position so grab_focus() doesn't jump the view for
            // move operations.  For edit operations scrollToFocused=true so we
            // let grab_focus() show the edited row instead.
            const scrollWin = findScrolledWindow(page);
            const scrollPos = scrollWin ? scrollWin.get_vadjustment().get_value() : 0;

            builtRows.forEach(row => monitorsGroup.remove(row));
            builtRows = buildMonitorRows(monitorsGroup, settings, window, (fId, scrollToFocused) => refreshAll(fId, scrollToFocused));
            if (focusId) {
                const target = builtRows.find(r => r._monitorId === focusId);
                if (target) {
                    target.grab_focus();
                    // For move operations: restore pre-rebuild scroll so the view
                    // stays stable.  For edit operations: let grab_focus() scroll
                    // to show the edited row.
                    if (!scrollToFocused && scrollWin) {
                        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                            scrollWin.get_vadjustment().set_value(scrollPos);
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }
            }
        };

        addBtn.connect('clicked', () => {
            showMonitorEditDialog(window, null, (newMonitor) => {
                const monitors = deserializeMonitors(settings.get_string('monitors'));
                monitors.push(newMonitor);
                settings.set_string('monitors', serializeMonitors(monitors));
                refreshAll();
            });
        });

        // ---- Presets group ----
        const presetsGroup = new Adw.PreferencesGroup({
            title:       _('Add Preset'),
            description: _('Click a preset to add it to your monitor list.'),
        });
        page.add(presetsGroup);

        let builtPresetRows = buildPresetRows(presetsGroup, settings, () => refreshAll());

        const refreshPresetRows = () => {
            builtPresetRows.forEach(row => presetsGroup.remove(row));
            builtPresetRows = buildPresetRows(presetsGroup, settings, () => refreshAll());
        };

        refreshAll = (focusId, scrollToFocused = false) => {
            refreshMonitorRows(focusId, scrollToFocused);
            refreshPresetRows();
        };

        // ---- Schedule Settings group ----
        const scheduleGroup = new Adw.PreferencesGroup({
            title:       _('Schedule Settings'),
            description: _('Applied globally to all scheduled monitors.'),
        });
        page.add(scheduleGroup);

        const jitterRow = new Adw.ActionRow({
            title:    _('Schedule Jitter (%)'),
            subtitle: _('Random ±% offset on each poll interval — set to 0 for exact timing'),
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

        // ---- On-demand time display ----
        const timeDisplayRow = new Adw.ActionRow({
            title:    _('On-demand time display'),
            subtitle: _('Show collection time beneath on-demand monitor values'),
        });
        const TIME_DISPLAY_VALUES  = ['none', 'age', 'timestamp'];
        const TIME_DISPLAY_LABELS  = [_('None'), _('Age (relative)'), _('Timestamp (HH:MM:SS)')];
        const timeDisplayDrop = new Gtk.DropDown({
            model:  Gtk.StringList.new(TIME_DISPLAY_LABELS),
            valign: Gtk.Align.CENTER,
        });
        const currentTd = settings.get_string('on-demand-time-display');
        timeDisplayDrop.set_selected(Math.max(0, TIME_DISPLAY_VALUES.indexOf(currentTd)));
        timeDisplayDrop.connect('notify::selected', () => {
            settings.set_string(
                'on-demand-time-display',
                TIME_DISPLAY_VALUES[timeDisplayDrop.get_selected()] ?? 'none',
            );
        });
        timeDisplayRow.add_suffix(timeDisplayDrop);
        scheduleGroup.add(timeDisplayRow);

        // ---- Debug logging toggle ----
        const debugRow = new Adw.ActionRow({
            title:    _('Debug Logging'),
            subtitle: 'Log command executions to debug.log; also logs startup timing to the journal (journalctl -b | grep [monish2])',
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
            title:    _('Debug Log'),
            subtitle: _('View the debug log file'),
        });
        const viewLogBtn = new Gtk.Button({
            label:       _('View Log'),
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
        label:       _('Clear Log'),
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
        title:          _('Debug Log'),
        transient_for:  parent,
        modal:          false,
        default_width:  720,
        default_height: 500,
    });
    win.set_content(toolbarView);
    win.present();
}

// ---------------------------------------------------------------------------
// Help dialog
// ---------------------------------------------------------------------------

/**
 * Open a modal dialog showing pre-formatted setup/help text.
 * Text is rendered in a monospace, selectable label so users can copy commands.
 *
 * @param {Gtk.Window} parent - Transient parent (the prefs window or edit dialog).
 * @param {string}     text   - Setup instructions to display.
 */
function showHelpDialog(parent, text) {
    const label = new Gtk.Label({
        label:         text,
        xalign:        0,
        margin_top:    12,
        margin_bottom: 12,
        margin_start:  16,
        margin_end:    16,
        wrap:          true,
        selectable:    true,
        monospace:     true,
    });

    const dialog = new Gtk.Dialog({
        title:         _('Setup Instructions'),
        transient_for: parent,
        modal:         true,
        default_width: 560,
        resizable:     false,
    });
    dialog.add_button(_('Close'), Gtk.ResponseType.CLOSE);
    dialog.get_content_area().append(label);
    dialog.connect('response', () => dialog.destroy());
    dialog.present();
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
            title:     _('No monitors yet'),
            subtitle:  _('Use "Add Monitor" or a preset below.'),
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

        const cmdPreview = monitor.command.replace(/\s+/g, ' ').trim().slice(0, 60) + (monitor.command.length > 60 ? '…' : '');
        let intervalStr;
        if (monitor.intervalSeconds === 0) {
            intervalStr = 'on-demand';
        } else {
            const {magnitude, unit} = splitInterval(monitor.intervalSeconds);
            const unitLabel = magnitude === 1 ? unit.slice(0, -1) : unit;
            intervalStr = `every ${magnitude} ${unitLabel}`;
        }
        const normalSubtitle = monitor.description
            ? `${monitor.description}\n${intervalStr} — ${cmdPreview}`
            : `${intervalStr} — ${cmdPreview}`;
        const row = new Adw.ActionRow({
            title:    monitor.name,
            subtitle: normalSubtitle,
        });
        if (!monitor.enabled)
            row.opacity = 0.5;

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
            tooltip_text: _('Move up'),
            sensitive:    !isFirst,
        });
        upBtn.connect('clicked', () => {
            const all = deserializeMonitors(settings.get_string('monitors'));
            const idx  = all.findIndex(m => m.id === monitor.id);
            if (idx > 0) {
                [all[idx - 1], all[idx]] = [all[idx], all[idx - 1]];
                settings.set_string('monitors', serializeMonitors(all));
                refresh(monitor.id);
            }
        });

        // Move-down button — disabled for the last row
        const downBtn = new Gtk.Button({
            icon_name:    'go-down-symbolic',
            valign:       Gtk.Align.CENTER,
            css_classes:  ['flat'],
            tooltip_text: _('Move down'),
            sensitive:    !isLast,
        });
        downBtn.connect('clicked', () => {
            const all = deserializeMonitors(settings.get_string('monitors'));
            const idx  = all.findIndex(m => m.id === monitor.id);
            if (idx < all.length - 1) {
                [all[idx], all[idx + 1]] = [all[idx + 1], all[idx]];
                settings.set_string('monitors', serializeMonitors(all));
                refresh(monitor.id);
            }
        });

        // Edit button
        const editBtn = new Gtk.Button({
            icon_name:   'document-edit-symbolic',
            valign:      Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Edit'),
        });
        editBtn.connect('clicked', () => {
            // Clear any error from a previous failed edit attempt.
            row.subtitle = normalSubtitle;
            try {
                showMonitorEditDialog(parentWindow, monitor, (updated) => {
                    try {
                        mutateMonitor(settings, monitor.id, () => updated);
                        // scrollToFocused=true: show the edited row instead of restoring
                        // the pre-rebuild scroll position (ISSUE 111).
                        refresh(monitor.id, true);
                    } catch (e) {
                        row.subtitle = `⚠ ${String(e.message ?? e)}`;
                    }
                });
            } catch (e) {
                row.subtitle = `⚠ ${String(e.message ?? e)}`;
            }
        });

        // Duplicate button — inserts a copy immediately after this row
        const dupBtn = new Gtk.Button({
            icon_name:   'edit-copy-symbolic',
            valign:      Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Duplicate'),
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
            tooltip_text: _('Delete'),
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
        row._monitorId = monitor.id;
        group.add(row);
        added.push(row);
    }

    return added;
}

// ---------------------------------------------------------------------------
// Helper: external preset loader
// ---------------------------------------------------------------------------

/**
 * Load preset definitions from a directory by scanning for *.json files.
 * Accepts both legacy bare-array exports and the versioned envelope format.
 * Each returned preset has a _sourceFile field with the JSON filename.
 * Silently ignores unreadable / invalid files.
 *
 * @param {string} dir - Absolute path to the directory.
 * @returns {object[]} Partial monitor objects suitable for createMonitor().
 */
function loadPresetsFromDir(dir) {
    const directory = Gio.File.new_for_path(dir);
    if (!directory.query_exists(null)) return [];
    let enumerator;
    try {
        enumerator = directory.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE, null,
        );
    } catch (_) { return []; }

    const presets = [];
    try {
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (!name.endsWith('.json')) continue;
            const file = directory.get_child(name);
            try {
                const [, bytes] = GLib.file_get_contents(file.get_path());
                const parsed = JSON.parse(new TextDecoder().decode(bytes));
                const raw = Array.isArray(parsed) ? parsed
                    : (parsed?.version && Array.isArray(parsed.monitors)) ? parsed.monitors
                    : null;
                if (!raw) continue;
                for (const m of raw) {
                    if (!m.name || !m.command) continue;
                    m._sourceFile = name;
                    presets.push(m);
                }
            } catch (_) { /* skip unreadable / invalid file */ }
        }
    } finally {
        try { enumerator.close(null); } catch (_) {}
    }
    return presets;
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
    const monitors    = deserializeMonitors(settings.get_string('monitors'));
    const addedNames  = new Set(monitors.map(m => m.name));
    const external    = EXTERNAL_PRESET_DIRS.flatMap(dir => loadPresetsFromDir(dir));
    const allPresets  = [...PRESET_MONITORS, ...external];
    const added       = [];

    for (const preset of allPresets) {
        if (addedNames.has(preset.name)) continue;

        const extSrc = preset._sourceFile;
        const rowProps = {
            title:    extSrc ? `\u26A0 ${preset.name}` : preset.name,
            subtitle: summarisePreset(preset),
        };
        if (extSrc)
            rowProps.tooltip_text = extSrc;
        const row = new Adw.ActionRow(rowProps);
        const addBtn = new Gtk.Button({
            icon_name:    'list-add-symbolic',
            valign:       Gtk.Align.CENTER,
            css_classes:  ['flat'],
            tooltip_text: _('Add to my monitors'),
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
            title:     _('All presets added'),
            subtitle:  _('Every available preset is already in your monitors.'),
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
 * Depth-first search for the first Gtk.ScrolledWindow in a widget's subtree.
 * Used to save/restore the page scroll position around a row rebuild so the
 * up/down move doesn't cause a visible scroll jump.
 *
 * @param {Gtk.Widget} widget
 * @returns {Gtk.ScrolledWindow|null}
 */
function findScrolledWindow(widget) {
    if (!widget) return null;
    let child = widget.get_first_child();
    while (child) {
        if (child instanceof Gtk.ScrolledWindow) return child;
        const found = findScrolledWindow(child);
        if (found) return found;
        child = child.get_next_sibling();
    }
    return null;
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
