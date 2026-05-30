/**
 * Pre-defined monitor configurations for common system metrics.
 *
 * All commands use only tools guaranteed to be present on Fedora, Debian,
 * Ubuntu, and Arch Linux (/proc filesystem, GJS/GLib, free, ps).
 * Commands that require a sampling interval are written in GJS JavaScript
 * (type: 'javascript') using GLib.usleep so no python3 dependency is needed.
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
// Helpers embedded in preset commands
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
        description:     'Current clock speed of cpu0 read from the kernel cpufreq scaling driver.',
        // scaling_cur_freq is in kHz; convert to MHz
        command:         'awk \'{printf "%.0f MHz", $1/1000}\' /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo "N/A"',
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
    {
        name:            'CPU Temperature',
        description:     'Temperature of thermal_zone0 (typically the CPU package sensor) in °C.',
        // thermal_zone0 is most commonly the CPU thermal zone
        command:         'awk \'{printf "%.1f", $1/1000}\' /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "N/A"',
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
        command:         'free -h | awk \'/^Mem/{print $3 "/" $2}\'',
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
    {
        name:            'RAM Free',
        description:     'Amount of RAM not in use (excludes buffers/cache).',
        command:         'free -h | awk \'/^Mem/{print $4}\'',
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
        command:         'free -h | awk \'/^Swap/{if($2=="0B" || $2=="0")print "No swap"; else print $3 "/" $2}\'',
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
        command:         'awk \'{printf "%.1f", $1/1000}\' /sys/class/thermal/thermal_zone1/temp 2>/dev/null || echo "N/A"',
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
        // Searches all power_supply entries for the first battery capacity
        command:         'find /sys/class/power_supply -name capacity 2>/dev/null | head -1 | xargs cat 2>/dev/null | awk \'{print $1"%"}\' || echo "N/A"',
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
        command:         'ps aux --sort=-%cpu 2>/dev/null | awk \'NR>=2 && NR<=4 {printf "%s %.0f%%  ", substr($11,1,10), $3}\'',
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
    {
        name:            'Top MEM Processes',
        description:     'Names and MEM% of the 3 processes currently consuming the most RAM.',
        command:         'ps aux --sort=-%mem 2>/dev/null | awk \'NR>=2 && NR<=4 {printf "%s %.0f%%  ", substr($11,1,10), $4}\'',
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
];
