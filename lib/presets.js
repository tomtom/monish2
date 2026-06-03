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

/** GJS JavaScript that prints free (unused) RAM in human-readable form (matches `free`'s "free" column). */
const RAM_FREE_JS = MEMINFO_JS_PREFIX + `\
    print(_fmt(_get('MemFree')));
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
// Entries like AC lack a capacity file; read each with its own try/catch so a
// missing file skips that entry rather than aborting the whole scan.
try {
    const en = Gio.File.new_for_path('/sys/class/power_supply')
        .enumerate_children('standard::name', 0, null);
    let info, found = false;
    while (!found && (info = en.next_file(null)) !== null) {
        try {
            const [, b] = GLib.file_get_contents(
                '/sys/class/power_supply/' + info.get_name() + '/capacity');
            print(new TextDecoder().decode(b).trim() + '%');
            found = true;
        } catch (_) { /* entry has no capacity file — skip */ }
    }
    if (!found) print('N/A');
} catch (_) { print('N/A'); }`;

// ---------------------------------------------------------------------------
// Battery time-remaining helper
// ---------------------------------------------------------------------------

/**
 * GJS JavaScript that estimates remaining battery time when discharging.
 * Reads energy_now and power_now (µWh / µW) from the first battery entry in
 * /sys/class/power_supply.  Falls back to charge_now/current_now for batteries
 * that expose charge instead of energy.  Returns "N/A" on AC or when the kernel
 * driver does not expose power draw.
 */
const BATTERY_TIME_JS = `\
try {
    const Gio = imports.gi.Gio;
    const base = '/sys/class/power_supply';
    const read = p => { try { return new TextDecoder().decode(GLib.file_get_contents(p)[1]).trim(); } catch(_) { return null; } };
    const en = Gio.File.new_for_path(base).enumerate_children('standard::name', 0, null);
    let info, result = null;
    while (!result && (info = en.next_file(null)) !== null) {
        const dir = base + '/' + info.get_name();
        const status = read(dir + '/status');
        if (status !== 'Discharging') continue;
        const eNow = parseInt(read(dir + '/energy_now') ?? '0');
        const pNow = parseInt(read(dir + '/power_now')  ?? '0');
        if (eNow > 0 && pNow > 0) {
            const h = eNow / pNow;
            const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
            result = hh + 'h ' + mm + 'm';
        } else {
            const cNow = parseInt(read(dir + '/charge_now') ?? '0');
            const iNow = parseInt(read(dir + '/current_now') ?? '0');
            if (cNow > 0 && iNow > 0) {
                const h = cNow / iNow;
                const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
                result = hh + 'h ' + mm + 'm';
            }
        }
    }
    print(result ?? 'AC');
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
const _exclude = typeof EXCLUDE !== 'undefined' && EXCLUDE ? new RegExp(EXCLUDE) : null;
const _count = typeof COUNT !== 'undefined' && parseInt(COUNT) > 0 ? parseInt(COUNT) : 3;
const procs = _listPids().map(pid => {
    const stat = _readFile('/proc/' + pid + '/stat');
    const comm = _readFile('/proc/' + pid + '/comm');
    if (!stat || !comm) return null;
    if (_exclude && _exclude.test(comm)) return null;
    const end = stat.lastIndexOf(')');
    const f = end >= 0 ? stat.slice(end + 2).split(' ') : null;
    if (!f) return null;
    const elapsed = uptime - parseInt(f[19]) / 100;
    return elapsed > 0
        ? { comm, cpu: Math.round((parseInt(f[11]) + parseInt(f[12])) / 100 / elapsed * 100) }
        : null;
}).filter(Boolean).sort((a, b) => b.cpu - a.cpu).slice(0, _count);
print(procs.length > 0 ? procs.map(p => p.comm + ' ' + p.cpu + '%').join('\\n') : 'idle');
`;

/**
 * GJS JavaScript that prints the 3 processes with the highest resident memory
 * (VmRSS from /proc/[pid]/status) as a percentage of total RAM, one per line.
 */
const TOP_MEM_PROCS_JS = PROC_JS_PREFIX + `\
const _exclude = typeof EXCLUDE !== 'undefined' && EXCLUDE ? new RegExp(EXCLUDE) : null;
const _count = typeof COUNT !== 'undefined' && parseInt(COUNT) > 0 ? parseInt(COUNT) : 3;
const _fmtMem = kb => kb >= 1048576 ? (kb / 1048576).toFixed(1) + 'G' : Math.round(kb / 1024) + 'M';
const procs = _listPids().map(pid => {
    const status = _readFile('/proc/' + pid + '/status');
    const comm   = _readFile('/proc/' + pid + '/comm');
    if (!status || !comm) return null;
    if (_exclude && _exclude.test(comm)) return null;
    const m = /^VmRSS:\\s+(\\d+)/m.exec(status);
    return m ? { comm, mem: parseInt(m[1]) } : null;
}).filter(Boolean).sort((a, b) => b.mem - a.mem).slice(0, _count);
print(procs.length > 0 ? procs.map(p => p.comm + ' ' + _fmtMem(p.mem)).join('\\n') : 'idle');
`;

// ---------------------------------------------------------------------------
// Intel RAPL CPU power helper
// ---------------------------------------------------------------------------

/**
 * GJS JavaScript that estimates instantaneous CPU power draw by reading the
 * Intel RAPL package energy counter twice over ~0.5 s and computing the delta.
 *
 * The energy_uj file requires read permission.  Without root access, grant it
 * once with:
 *   sudo chmod a+r /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj
 * Or create a persistent udev rule:
 *   echo 'SUBSYSTEM=="powercap", KERNEL=="intel-rapl:0", ACTION=="add", RUN+="/bin/chmod a+r %S%p/energy_uj"' \
 *     | sudo tee /etc/udev/rules.d/51-rapl.rules && sudo udevadm trigger
 */
const RAPL_POWER_JS = `\
try {
    const path = '/sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj';
    const read = () => parseInt(new TextDecoder().decode(GLib.file_get_contents(path)[1]).trim());
    const e1 = read();
    GLib.usleep(500000);
    const e2 = read();
    const watts = ((e2 - e1) / 1e6 / 0.5).toFixed(1);
    print(watts + ' W');
} catch (_) {
    print('N/A (chmod a+r /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj)');
}`;

// ---------------------------------------------------------------------------
// Logged-in users helper
// ---------------------------------------------------------------------------

/**
 * GJS JavaScript that reads login sessions via the `who` command and prints
 * one line per unique user in the format "NAME: HOW, HOW..." where HOW lists
 * distinct login methods (seat0, tty2, pts/0, …).
 *
 * Uses GLib.spawn_command_line_sync so no external executor is needed.
 * Falls back to "N/A" when who is unavailable.
 */
const LOGGED_IN_USERS_JS = `\
try {
    const [ok, out] = GLib.spawn_command_line_sync('who');
    if (!ok || !out) { print('N/A'); } else {
        const byUser = new Map();
        for (const line of new TextDecoder().decode(out).split('\\n').filter(l => l.trim())) {
            const parts = line.split(/\\s+/);
            const name = parts[0], how = parts[1] ?? '?';
            if (!name) continue;
            if (!byUser.has(name)) byUser.set(name, []);
            if (!byUser.get(name).includes(how)) byUser.get(name).push(how);
        }
        const users = [...byUser.keys()].sort();
        print(users.length > 0
            ? users.map(u => u + ': ' + byUser.get(u).join(', ')).join('\\n')
            : 'none');
    }
} catch (_) { print('N/A'); }`;

// ---------------------------------------------------------------------------
// Last login helper
// ---------------------------------------------------------------------------

/**
 * GJS JavaScript that reads the most recent login entry from last(1) and
 * prints "user  tty  date time" (e.g. "tom  pts/1  Mon Jun 2 08:53").
 * Uses last -n 1 -w (util-linux) which is available on all major distros.
 * Falls back to "N/A" when last is unavailable or wtmp is empty.
 */
const LAST_LOGIN_JS = `\
try {
    const [ok, out] = GLib.spawn_command_line_sync('last -n 1 -w');
    if (!ok || !out) { print('N/A'); } else {
        const line = new TextDecoder().decode(out).split('\\n')
            .find(l => l.trim() && !l.startsWith('wtmp') && !l.startsWith('btmp'));
        if (!line) { print('N/A'); } else {
            const p    = line.split(/\\s+/);
            const user = p[0] ?? 'N/A';
            const tty  = p[1] ?? 'N/A';
            const dm   = /(\\w{3}\\s+\\w{3}\\s+\\d+\\s+\\d{2}:\\d{2})/.exec(line);
            const when = dm ? dm[1].replace(/\\s+/g, ' ') : '?';
            print(user + '  ' + tty + '  ' + when);
        }
    }
} catch (_) { print('N/A'); }`;

// ---------------------------------------------------------------------------
// Remote desktop helper
// ---------------------------------------------------------------------------

/**
 * GJS JavaScript that runs `grdctl status` and extracts the RDP
 * enabled/disabled state.  `grdctl` is part of gnome-remote-desktop (GNOME 42+).
 *
 * Falls back to "N/A" when grdctl is not installed or the command fails.
 * The output is a single word: "enabled" or "disabled".
 */
const GNOME_RDP_JS = `\
try {
    const [ok, out] = GLib.spawn_command_line_sync('grdctl status');
    if (!ok || !out) { print('N/A'); } else {
        const text = new TextDecoder().decode(out);
        const m = /RDP:\\s*[\\r\\n]+\\s+Status:\\s*(\\S+)/i.exec(text);
        print(m ? m[1] : 'N/A');
    }
} catch (_) { print('N/A'); }`;

// ---------------------------------------------------------------------------
// Claude usage helper
// ---------------------------------------------------------------------------

/**
 * GJS JavaScript that reads the Claude Code OAuth token from
 * ~/.claude/.credentials.json, calls the Anthropic usage API, and prints
 * two lines: "5h: N%" and "7d: N%" for the session and weekly windows.
 *
 * Requires an active Claude Code login (run `claude` and log in first).
 * Uses Soup 3 for HTTP; outputs "Error: …" on any failure so the monitor
 * still shows something meaningful rather than going ERROR.
 */
const CLAUDE_USAGE_JS = `\
imports.gi.versions.Soup = '3.0';
const Soup = imports.gi.Soup;
const CREDS = GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';

let token;
try {
    const [ok, bytes] = GLib.file_get_contents(CREDS);
    if (!ok) { print('No credentials — run claude and log in first'); return; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const c = data.claudeAiOauth ?? data;
    if (!c.accessToken) { print('No accessToken in credentials file'); return; }
    token = c.accessToken;
} catch (_) { print('No credentials — run claude and log in first'); return; }

const session = new Soup.Session();
const msg = Soup.Message.new('GET', ENDPOINT);
const h = msg.get_request_headers();
h.append('Authorization', 'Bearer ' + token);
h.append('anthropic-beta', 'oauth-2025-04-20');
h.append('Content-Type', 'application/json');
h.append('User-Agent', 'monish2');

let data;
try {
    const bytes = session.send_and_read(msg, null);
    if (msg.get_status() !== 200) {
        print('HTTP ' + msg.get_status());
        return;
    }
    data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
} catch (e) { print('Error: ' + e.message); return; }

const five  = data.five_hour ?? data.fiveHour  ?? null;
const seven = data.seven_day ?? data.sevenDay  ?? null;

function pct(w) {
    if (!w || typeof w !== 'object') return '?';
    const u = w.utilization ?? w.used_pct ?? w.percentage ?? null;
    return u !== null ? Math.round(Number(u)) + '%' : '?';
}

print('5h: ' + pct(five));
print('7d: ' + pct(seven));`;

// ---------------------------------------------------------------------------
// OpenRouter usage helper
// ---------------------------------------------------------------------------

/**
 * GJS JavaScript that reads an OpenRouter provisioning/management key from the
 * OPENROUTER_API_KEY env var or ~/.config/openrouter/key, fetches the credits
 * and 30-day activity endpoints, and prints two lines:
 *   "Balance: $X.XX"
 *   "Activity (30d): N req / $X.XX"
 *
 * The provisioning key is different from a regular API key — generate it at
 * openrouter.ai/settings/provisioning-keys.
 */
const OPENROUTER_USAGE_JS = `\
imports.gi.versions.Soup = '3.0';
const Soup = imports.gi.Soup;
const KEY_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'openrouter', 'key']);

let key = GLib.getenv('OPENROUTER_API_KEY') || GLib.getenv('OPENROUTER_KEY') || null;
if (!key) {
    try {
        const [ok, bytes] = GLib.file_get_contents(KEY_PATH);
        if (ok) key = new TextDecoder().decode(bytes).trim() || null;
    } catch (_) {}
}
if (!key) {
    print('No key — set OPENROUTER_API_KEY or write to ~/.config/openrouter/key');
    return;
}

const session = new Soup.Session();
function getJson(path) {
    const m = Soup.Message.new('GET', 'https://openrouter.ai/api/v1' + path);
    const h = m.get_request_headers();
    h.append('Authorization', 'Bearer ' + key);
    h.append('Content-Type', 'application/json');
    h.append('User-Agent', 'monish2');
    const bytes = session.send_and_read(m, null);
    const status = m.get_status();
    const body = new TextDecoder().decode(bytes.get_data());
    if (status !== 200) throw new Error('HTTP ' + status);
    return JSON.parse(body);
}

try {
    const credits  = getJson('/credits');
    const activity = getJson('/activity');

    const cd        = credits.data ?? credits;
    const purchased = Number(cd.total_credits ?? 0);
    const used      = Number(cd.total_usage   ?? 0);
    const balance   = (purchased - used).toFixed(2);

    const rows = activity.data ?? activity ?? [];
    let totalReq = 0, totalSpend = 0;
    for (const row of rows) {
        totalReq   += Number(row.requests ?? 0);
        totalSpend += Number(row.usage    ?? 0);
    }

    print('Balance: $' + balance);
    print('Activity (30d): ' + totalReq + ' req / $' + totalSpend.toFixed(2));
} catch (e) { print('Error: ' + e.message); }`;

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
        name:            'CPU Power (RAPL)',
        description:     'Estimated CPU package power draw in watts via Intel RAPL (samples /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj over 0.5 s). Requires read access to energy_uj — enable once without sudo: sudo chmod a+r /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj; or add a udev rule (see Setup instructions).',
        helpText:        `Grant read access to the Intel RAPL energy counter:

  /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj

Option 1 — Temporary (reverts on reboot):
  sudo chmod a+r /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj

Option 2 — Persistent udev rule (survives reboots):
  echo 'SUBSYSTEM=="powercap", KERNEL=="intel-rapl:0", ACTION=="add", RUN+="/bin/chmod a+r %S%p/energy_uj"' \\
    | sudo tee /etc/udev/rules.d/51-rapl.rules
  sudo udevadm trigger`,
        command:         RAPL_POWER_JS,
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
        description:     'Amount of RAM that is completely unused (MemFree from /proc/meminfo, matching the "free" column of `free -h`).',
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
        name:            'Thermal Zone 0',
        description:     'Temperature of thermal_zone0 (typically the CPU package sensor) in °C.',
        command:         thermalJS(0),
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: ['>70'],
        dangerPatterns:  ['>90'],
        enabled:         true,
    },
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
    {
        name:            'Battery Time Remaining',
        description:     'Estimated remaining battery time when discharging (reads energy_now/power_now or charge_now/current_now from sysfs). Shows "AC" when on mains power.',
        command:         BATTERY_TIME_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: ['<1h'],
        dangerPatterns:  ['<30m'],
        enabled:         true,
        showSparkline:   false,
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
        args:            [
            {name: 'EXCLUDE', label: 'Exclude regexp', default: '^(gjs)$'},
            {name: 'COUNT',   label: 'Process count',  default: '3'},
        ],
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
        args:            [
            {name: 'EXCLUDE', label: 'Exclude regexp', default: 'gjs'},
            {name: 'COUNT',   label: 'Process count',  default: '3'},
        ],
    },

    // ---- Remote ------------------------------------------------------------
    {
        name:            'Gnome RDP',
        description:     'GNOME Remote Desktop RDP status (enabled/disabled). CAUTION when enabled.',
        command:         GNOME_RDP_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: ['enabled'],
        dangerPatterns:  [],
        enabled:         true,
        actions:         [
            {label: 'Enable',  command: 'grdctl rdp enable',  type: MonitorType.SHELL, guard: 'value === \'disabled\''},
            {label: 'Disable', command: 'grdctl rdp disable', type: MonitorType.SHELL, guard: 'value === \'enabled\''},
        ],
    },

    // ---- AI services -------------------------------------------------------
    {
        name:            'Claude Usage',
        description:     'Claude Code session (5 h) and weekly (7 d) utilisation from the Anthropic OAuth usage API. Requires an active Claude Code login (~/.claude/.credentials.json). CAUTION ≥75 %, DANGER ≥90 %.',
        helpText:        `Requires a Claude Code login session.  If this monitor shows "No credentials", run:

  claude

and complete the login flow.  The credentials are stored at:

  ~/.claude/.credentials.json`,
        command:         CLAUDE_USAGE_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: 0,
        outputRegex:     '',
        cautionPatterns: ['(?:7[5-9]|8\\d|9\\d|100)%'],
        dangerPatterns:  ['(?:9[0-9]|100)%'],
        enabled:         true,
        showSparkline:   false,
    },
    {
        name:            'OpenRouter',
        description:     'OpenRouter account balance and 30-day activity (requests and spend). Requires a provisioning/management key from openrouter.ai/settings/provisioning-keys. CAUTION balance <$10, DANGER balance <$5.',
        helpText:        `Requires an OpenRouter provisioning key (not a regular API key).

Generate one at: openrouter.ai/settings/provisioning-keys

Provide it via one of:
  export OPENROUTER_API_KEY=sk-or-v1-…
  echo sk-or-v1-… > ~/.config/openrouter/key`,
        command:         OPENROUTER_USAGE_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: 0,
        outputRegex:     '',
        cautionPatterns: ['Balance: \\$[0-9]\\.'],
        dangerPatterns:  ['Balance: \\$[0-4]\\.'],
        enabled:         true,
        showSparkline:   false,
    },

    // ---- Users -------------------------------------------------------------
    {
        name:            'Last Login',
        description:     'Most recent login from last(1): username, terminal, date and time.',
        command:         LAST_LOGIN_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
        showSparkline:   false,
    },
    {
        name:            'Logged-in Users',
        description:     'Unique usernames of all currently logged-in users (via who / coreutils).',
        command:         LOGGED_IN_USERS_JS,
        type:            MonitorType.JAVASCRIPT,
        intervalSeconds: PRESET_MIN_INTERVAL,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
        showSparkline:   false,
    },
];
