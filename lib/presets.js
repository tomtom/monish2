/**
 * Pre-defined monitor configurations for common system metrics.
 *
 * All commands use only tools guaranteed to be present on Fedora, Debian,
 * Ubuntu, and Arch Linux (/proc filesystem, GJS/GLib, Gio).
 * Every preset uses type: JAVASCRIPT so no external shell utilities are needed.
 *
 * Each preset is a partial monitor object suitable for spreading into
 * createMonitor() — it has everything except `id` (assigned on add).
 */

import {MonitorType} from './monitor.js';

/**
 * Minimum polling interval (seconds) enforced for all preset monitors.
 * Prevents the presets from running too aggressively by default.
 */
export const PRESET_MIN_INTERVAL = 60;

// ---------------------------------------------------------------------------
// CPU helpers
// ---------------------------------------------------------------------------

/**
 * GJS JavaScript that samples /proc/stat over 0.5 s and prints CPU %.
 * Uses GLib.usleep for the blocking sample interval (safe in a subprocess).
 */
const CPU_USAGE_JS = `\
const GLib = imports.gi.GLib;
function readCpuFields() {
    const [, b] = GLib.file_get_contents('/proc/stat');
    const line = new TextDecoder().decode(b).split('\\n')[0];
    return line.split(/\\s+/).slice(1).map(Number);
}
const s1 = readCpuFields();
GLib.usleep(500000);
const s2 = readCpuFields();
const d = s2.map((v, i) => v - s1[i]);
const total = d.reduce((a, b) => a + b, 0);
print(Math.round((total - d[3]) * 100 / total));`;

/**
 * GJS JavaScript that reads the cpufreq scaling_cur_freq file (kHz) and
 * converts it to MHz.  Falls back to "N/A" when the file is absent.
 */
const CPU_FREQ_JS = `\
const [ok, b] = GLib.file_get_contents('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq');
if (!ok) { print('N/A'); } else {
    const kHz = parseInt(new TextDecoder().decode(b).trim());
    print(isNaN(kHz) ? 'N/A' : Math.round(kHz / 1000) + ' MHz');
}`;

/**
 * Build GJS JavaScript that reads a thermal zone temperature (milli-°C from
 * the kernel sysfs interface) and prints it in °C with one decimal place.
 *
 * @param {number} zone - Thermal zone index (0, 1, …).
 * @returns {string} JavaScript source.
 */
function thermalJS(zone) {
    // GLib.file_get_contents throws (not [false,…]) when the file is absent,
    // so we need try/catch — thermal_zone1+ may not exist on all machines.
    return `\
try {
    const [, b] = GLib.file_get_contents('/sys/class/thermal/thermal_zone${zone}/temp');
    const mC = parseInt(new TextDecoder().decode(b).trim());
    print(isNaN(mC) ? 'N/A' : (mC / 1000).toFixed(1));
} catch (_) { print('N/A'); }`;
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

/**
 * GJS JavaScript that measures per-interface RX or TX bytes over 1 s
 * using the default route interface from /proc/net/route.
 *
 * @param {'rx'|'tx'} direction
 * @returns {string} JavaScript source (body of async IIFE in executor).
 */
function netRateJS(direction) {
    const col = direction === 'rx' ? 1 : 9;
    return `\
const GLib = imports.gi.GLib;
function getDefaultIface() {
    const [ok, b] = GLib.file_get_contents('/proc/net/route');
    if (!ok) return 'eth0';
    for (const line of new TextDecoder().decode(b).split('\\n').slice(1)) {
        const p = line.trim().split(/\\s+/);
        if (p[1] === '00000000') return p[0];
    }
    return 'eth0';
}
function getDevBytes(iface) {
    const [ok, b] = GLib.file_get_contents('/proc/net/dev');
    if (!ok) return 0;
    for (const line of new TextDecoder().decode(b).split('\\n'))
        if (line.trim().startsWith(iface + ':'))
            return parseInt(line.trim().split(/\\s+/)[${col}]) || 0;
    return 0;
}
const iface = getDefaultIface();
const b1 = getDevBytes(iface);
GLib.usleep(1000000);
const b2 = getDevBytes(iface);
const delta = b2 - b1;
print(delta < 1048576
    ? \`\${(delta / 1024).toFixed(1)} KB/s\`
    : \`\${(delta / 1048576).toFixed(2)} MB/s\`);`;
}

// ---------------------------------------------------------------------------
// Memory helpers
// ---------------------------------------------------------------------------

/**
 * Shared GJS prefix for RAM/Swap scripts.
 * Opens an else block that the appended script body must close with `}`.
 * Provides _get(name) → KiB value and _fmt(kb) → human-readable string.
 */
const MEMINFO_JS_PREFIX = `\
const [_ok, _b] = GLib.file_get_contents('/proc/meminfo');
if (!_ok) { print('N/A'); } else {
    const _t = new TextDecoder().decode(_b);
    const _get = n => { const m = new RegExp('^' + n + ':\\\\s+(\\\\d+)', 'm').exec(_t); return m ? parseInt(m[1]) : 0; };
    const _fmt = kb => kb >= 1048576 ? (kb / 1048576).toFixed(1) + 'G' : kb >= 1024 ? Math.round(kb / 1024) + 'M' : kb + 'K';
`;

/** GJS JavaScript that prints used/total RAM in human-readable form. */
const RAM_USED_JS = MEMINFO_JS_PREFIX + `\
    const t = _get('MemTotal'), a = _get('MemAvailable');
    print(_fmt(t - a) + '/' + _fmt(t));
}`;

/** GJS JavaScript that prints available (free) RAM in human-readable form. */
const RAM_FREE_JS = MEMINFO_JS_PREFIX + `\
    print(_fmt(_get('MemAvailable')));
}`;

/** GJS JavaScript that prints used/total swap, or "No swap" when disabled. */
const SWAP_USAGE_JS = MEMINFO_JS_PREFIX + `\
    const st = _get('SwapTotal'), sf = _get('SwapFree');
    print(st === 0 ? 'No swap' : _fmt(st - sf) + '/' + _fmt(st));
}`;

// ---------------------------------------------------------------------------
// Battery helper
// ---------------------------------------------------------------------------

/**
 * GJS JavaScript that enumerates /sys/class/power_supply looking for the
 * first `capacity` file and prints its value as a percentage.
 */
const BATTERY_LEVEL_JS = `\
const Gio = imports.gi.Gio;
try {
    const en = Gio.File.new_for_path('/sys/class/power_supply')
        .enumerate_children('standard::name', 0, null);
    let info, found = false;
    while (!found && (info = en.next_file(null)) !== null) {
        const [ok, b] = GLib.file_get_contents(
            '/sys/class/power_supply/' + info.get_name() + '/capacity');
        if (ok) { print(new TextDecoder().decode(b).trim() + '%'); found = true; }
    }
    if (!found) print('N/A');
} catch (_) { print('N/A'); }`;

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/**
 * Shared GJS prefix for Top CPU/MEM process scripts.
 * Provides _readFile(path) and _listPids() helpers for /proc enumeration.
 */
const PROC_JS_PREFIX = `\
const Gio = imports.gi.Gio;
function _readFile(path) {
    // GLib.file_get_contents throws on missing/unreadable files in GJS.
    // Proc entries vanish mid-scan when processes exit; return null on any error.
    try {
        const [, b] = GLib.file_get_contents(path);
        return new TextDecoder().decode(b).trim();
    } catch (_) { return null; }
}
function _listPids() {
    const pids = [];
    try {
        const en = Gio.File.new_for_path('/proc')
            .enumerate_children('standard::name,standard::type', 0, null);
        let info;
        while ((info = en.next_file(null)) !== null) {
            if (info.get_file_type() === Gio.FileType.DIRECTORY &&
                /^\\d+$/.test(info.get_name()))
                pids.push(info.get_name());
        }
    } catch (_) {}
    return pids;
}
`;

/**
 * GJS JavaScript that prints the 3 processes with the highest lifetime CPU%
 * (utime+stime vs elapsed wall time), one per line, using /proc/[pid]/stat.
 */
const TOP_CPU_PROCS_JS = PROC_JS_PREFIX + `\
const uptime = parseFloat((_readFile('/proc/uptime') ?? '1').split(' ')[0]);
const procs = _listPids().map(pid => {
    const stat = _readFile('/proc/' + pid + '/stat');
    const comm = _readFile('/proc/' + pid + '/comm');
    if (!stat || !comm) return null;
    const end = stat.lastIndexOf(')');
    const f = end >= 0 ? stat.slice(end + 2).split(' ') : null;
    if (!f) return null;
    const elapsed = uptime - parseInt(f[19]) / 100;
    return elapsed > 0
        ? { comm, cpu: Math.round((parseInt(f[11]) + parseInt(f[12])) / 100 / elapsed * 100) }
        : null;
}).filter(Boolean).sort((a, b) => b.cpu - a.cpu).slice(0, 3);
print(procs.length > 0 ? procs.map(p => p.comm + ' ' + p.cpu + '%').join('\\n') : 'idle');
`;

/**
 * GJS JavaScript that prints the 3 processes with the highest resident memory
 * (VmRSS from /proc/[pid]/status) as a percentage of total RAM, one per line.
 */
const TOP_MEM_PROCS_JS = PROC_JS_PREFIX + `\
const memTotal = (() => {
    const t = _readFile('/proc/meminfo');
    const m = t && /^MemTotal:\\s+(\\d+)/m.exec(t);
    return m ? parseInt(m[1]) : 1;
})();
const procs = _listPids().map(pid => {
    const status = _readFile('/proc/' + pid + '/status');
    const comm   = _readFile('/proc/' + pid + '/comm');
    if (!status || !comm) return null;
    const m = /^VmRSS:\\s+(\\d+)/m.exec(status);
    return m ? { comm, mem: parseInt(m[1]) } : null;
}).filter(Boolean).sort((a, b) => b.mem - a.mem).slice(0, 3);
print(procs.length > 0 ? procs.map(p => p.comm + ' ' + Math.round(p.mem / memTotal * 100) + '%').join('\\n') : 'idle');
`;

// ---------------------------------------------------------------------------
// Preset list
// ---------------------------------------------------------------------------

/**
 * All available preset monitors, ordered by category.
 * Each object is a valid argument for createMonitor().
 */
export const PRESET_MONITORS = [
    // ---- CPU ---------------------------------------------------------------
    {
        name:            'CPU Usage',
        description:     'Overall CPU utilisation across all cores (sampled over 0.5 s via /proc/stat).',
        command:         CPU_USAGE_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: ['>70'],
        dangerPatterns:  ['>90'],
        enabled:         true,
    },
    {
        name:            'CPU Frequency',
        description:     'Current clock speed of cpu0 in MHz, read from the kernel cpufreq scaling driver.',
        command:         CPU_FREQ_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
    {
        name:            'CPU Temperature',
        description:     'Temperature of thermal_zone0 (typically the CPU package sensor) in °C.',
        command:         thermalJS(0),
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: ['>70'],
        dangerPatterns:  ['>90'],
        enabled:         true,
    },

    // ---- RAM ---------------------------------------------------------------
    {
        name:            'RAM Used',
        description:     'Amount of RAM currently in use out of total physical memory.',
        command:         RAM_USED_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
    {
        name:            'RAM Free',
        description:     'Amount of RAM not in use (MemAvailable from /proc/meminfo).',
        command:         RAM_FREE_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },

    // ---- Swap --------------------------------------------------------------
    {
        name:            'Swap Usage',
        description:     'Swap space in use out of total; shows "No swap" when swap is disabled.',
        command:         SWAP_USAGE_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },

    // ---- Network -----------------------------------------------------------
    {
        name:            'Net Download',
        description:     'Inbound throughput on the default-route interface, sampled over 1 s.',
        command:         netRateJS('rx'),
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
    {
        name:            'Net Upload',
        description:     'Outbound throughput on the default-route interface, sampled over 1 s.',
        command:         netRateJS('tx'),
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },

    // ---- Thermal -----------------------------------------------------------
    {
        name:            'Thermal Zone 1',
        description:     'Temperature of thermal_zone1 (often a GPU or board sensor) in °C.',
        command:         thermalJS(1),
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: ['>70'],
        dangerPatterns:  ['>90'],
        enabled:         true,
    },

    // ---- Battery -----------------------------------------------------------
    {
        name:            'Battery Level',
        description:     'Battery charge percentage; warns when low to help avoid unexpected shutdowns.',
        command:         BATTERY_LEVEL_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '(\\d+)',
        cautionPatterns: ['<30'],
        dangerPatterns:  ['<10'],
        enabled:         true,
    },

    // ---- Processes ---------------------------------------------------------
    {
        name:            'Top CPU Processes',
        description:     'Names and CPU% of the 3 processes currently consuming the most CPU.',
        command:         TOP_CPU_PROCS_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
    {
        name:            'Top MEM Processes',
        description:     'Names and MEM% of the 3 processes currently consuming the most RAM.',
        command:         TOP_MEM_PROCS_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
];
