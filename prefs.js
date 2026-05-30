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
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

import {
    deserializeMonitors,
    serializeMonitors,
    createMonitor,
    validateMonitor,
} from './lib/monitor.js';
import {PRESET_MONITORS} from './lib/presets.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Interval units presented to the user. */
const INTERVAL_UNITS = ['seconds', 'minutes', 'hours'];

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

    // ---- Interval ----
    // Store internally in seconds; let the user pick a magnitude + unit.
    const {magnitude, unit} = splitInterval(data.intervalSeconds);

    const intervalSpin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            value:       magnitude,
            lower:       1,
            upper:       9999,
            step_increment: 1,
        }),
        numeric:  true,
        hexpand:  true,
    });
    const unitDropDown = new Gtk.DropDown({
        model: Gtk.StringList.new(INTERVAL_UNITS),
    });
    unitDropDown.set_selected(INTERVAL_UNITS.indexOf(unit));

    const intervalBox = new Gtk.Box({spacing: 8, hexpand: true});
    intervalBox.append(intervalSpin);
    intervalBox.append(unitDropDown);
    content.append(labeledRow('Interval', intervalBox));

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

            const selUnit  = INTERVAL_UNITS[unitDropDown.get_selected()] ?? 'seconds';
            const selMag   = intervalSpin.get_value_as_int();
            const totalSec = toSeconds(selMag, selUnit);

            const updated = {
                ...data,
                name:            nameEntry.get_text().trim(),
                command:         cmd,
                intervalSeconds: totalSec,
                outputRegex:     regexEntry.get_text().trim(),
                cautionPatterns: splitPatterns(cautionEntry.get_text()),
                dangerPatterns:  splitPatterns(dangerEntry.get_text()),
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

        // Rebuilds the monitor list rows from GSettings
        const refreshMonitorRows = () => {
            // Remove existing dynamic rows (all but the Add button row)
            while (monitorsGroup.get_last_child()) {
                monitorsGroup.remove(monitorsGroup.get_last_child());
            }
            buildMonitorRows(monitorsGroup, settings, window, refreshMonitorRows);
        };

        buildMonitorRows(monitorsGroup, settings, window, refreshMonitorRows);

        // Add Monitor button row
        const addRow = new Adw.ButtonRow({title: 'Add Monitor'});
        addRow.add_css_class('suggested-action');
        addRow.connect('activated', () => {
            showMonitorEditDialog(window, null, (newMonitor) => {
                const monitors = deserializeMonitors(settings.get_string('monitors'));
                monitors.push(newMonitor);
                settings.set_string('monitors', serializeMonitors(monitors));
                refreshMonitorRows();
            });
        });
        monitorsGroup.add(addRow);

        // ---- Presets group ----
        const presetsGroup = new Adw.PreferencesGroup({
            title:       'Add Preset',
            description: 'Click a preset to add it to your monitor list.',
        });
        page.add(presetsGroup);

        for (const preset of PRESET_MONITORS) {
            const row = new Adw.ActionRow({
                title:    preset.name,
                subtitle: summarisePreset(preset),
            });
            const addBtn = new Gtk.Button({
                icon_name:  'list-add-symbolic',
                valign:     Gtk.Align.CENTER,
                css_classes: ['flat'],
                tooltip_text: 'Add to my monitors',
            });
            addBtn.connect('clicked', () => {
                const monitors = deserializeMonitors(settings.get_string('monitors'));
                monitors.push(createMonitor(preset));
                settings.set_string('monitors', serializeMonitors(monitors));
                refreshMonitorRows();
            });
            row.add_suffix(addBtn);
            row.activatable_widget = addBtn;
            presetsGroup.add(row);
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: build monitor rows
// ---------------------------------------------------------------------------

/**
 * Populate a PreferencesGroup with one ActionRow per monitor.
 * Rows include Edit and Delete buttons.
 *
 * @param {Adw.PreferencesGroup} group
 * @param {Gio.Settings} settings
 * @param {Gtk.Window} parentWindow
 * @param {function():void} refresh - Called after any mutation.
 */
function buildMonitorRows(group, settings, parentWindow, refresh) {
    const monitors = deserializeMonitors(settings.get_string('monitors'));

    if (monitors.length === 0) {
        const emptyRow = new Adw.ActionRow({
            title:     'No monitors yet',
            subtitle:  'Use "Add Monitor" or a preset below.',
            sensitive: false,
        });
        group.add(emptyRow);
        return;
    }

    for (const monitor of monitors) {
        const row = new Adw.ActionRow({
            title:    monitor.name,
            subtitle: `every ${monitor.intervalSeconds}s — ${monitor.command.slice(0, 60)}${monitor.command.length > 60 ? '…' : ''}`,
        });

        // Enable/disable toggle
        const toggle = new Gtk.Switch({
            active: monitor.enabled,
            valign: Gtk.Align.CENTER,
        });
        toggle.connect('notify::active', () => {
            mutateMonitor(settings, monitor.id, m => ({...m, enabled: toggle.active}));
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
        row.add_suffix(editBtn);
        row.add_suffix(delBtn);
        group.add(row);
    }
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
 * Convert a value+unit pair to total seconds.
 *
 * @param {number} value
 * @param {'seconds'|'minutes'|'hours'} unit
 * @returns {number}
 */
function toSeconds(value, unit) {
    const multipliers = {seconds: 1, minutes: 60, hours: 3600};
    return value * (multipliers[unit] ?? 1);
}

/**
 * Split an interval in seconds into a human-friendly magnitude + unit pair.
 * Prefers larger units to avoid e.g. "3600 seconds".
 *
 * @param {number} seconds
 * @returns {{magnitude: number, unit: string}}
 */
function splitInterval(seconds) {
    if (seconds % 3600 === 0 && seconds >= 3600) return {magnitude: seconds / 3600, unit: 'hours'};
    if (seconds % 60   === 0 && seconds >= 60)   return {magnitude: seconds / 60,   unit: 'minutes'};
    return {magnitude: seconds, unit: 'seconds'};
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
 * Build a one-line summary string for a preset row subtitle.
 *
 * @param {object} preset
 * @returns {string}
 */
function summarisePreset(preset) {
    const parts = [`every ${preset.intervalSeconds}s`];
    if (preset.cautionPatterns?.length > 0) parts.push(`caution: ${preset.cautionPatterns[0]}`);
    if (preset.dangerPatterns?.length  > 0) parts.push(`danger: ${preset.dangerPatterns[0]}`);
    return parts.join(' · ');
}
