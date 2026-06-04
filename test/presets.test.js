/**
 * Unit tests for lib/presets.js.
 * Verifies that every preset has the required shape and sane defaults.
 */

import {PRESET_MONITORS, PRESET_MIN_INTERVAL} from '../lib/presets.js';
import {validateMonitor, MonitorType} from '../lib/monitor.js';

import {describe, it, expect} from '@jest/globals';

describe('PRESET_MONITORS', () => {
    it('is a non-empty array', () => {
        expect(Array.isArray(PRESET_MONITORS)).toBe(true);
        expect(PRESET_MONITORS.length).toBeGreaterThan(0);
    });

    it('every preset has a non-empty name', () => {
        for (const preset of PRESET_MONITORS) {
            expect(typeof preset.name).toBe('string');
            expect(preset.name.trim().length).toBeGreaterThan(0);
        }
    });

    it('every preset has a non-empty command', () => {
        for (const preset of PRESET_MONITORS) {
            expect(typeof preset.command).toBe('string');
            expect(preset.command.trim().length).toBeGreaterThan(0);
        }
    });

    it('every preset has a non-negative intervalSeconds (0 = on-demand)', () => {
        for (const preset of PRESET_MONITORS) {
            expect(typeof preset.intervalSeconds).toBe('number');
            expect(preset.intervalSeconds).toBeGreaterThanOrEqual(0);
        }
    });

    it(`every timed preset interval is at least PRESET_MIN_INTERVAL (${PRESET_MIN_INTERVAL}s)`, () => {
        for (const preset of PRESET_MONITORS) {
            if (preset.intervalSeconds === 0) continue; // on-demand — no timer
            expect(preset.intervalSeconds).toBeGreaterThanOrEqual(PRESET_MIN_INTERVAL);
        }
    });

    it('every preset passes validateMonitor', () => {
        for (const preset of PRESET_MONITORS) {
            const errors = validateMonitor(preset);
            expect(errors).toEqual([]);
        }
    });

    it('every preset has cautionPatterns and dangerPatterns as arrays', () => {
        for (const preset of PRESET_MONITORS) {
            expect(Array.isArray(preset.cautionPatterns)).toBe(true);
            expect(Array.isArray(preset.dangerPatterns)).toBe(true);
        }
    });

    it('preset names are unique', () => {
        const names = PRESET_MONITORS.map(p => p.name);
        const unique = new Set(names);
        expect(unique.size).toBe(names.length);
    });

    it('contains expected categories', () => {
        const names = PRESET_MONITORS.map(p => p.name.toLowerCase());
        // Must include CPU, RAM/memory, battery, swap, users
        expect(names.some(n => n.includes('cpu'))).toBe(true);
        expect(names.some(n => n.includes('ram') || n.includes('mem'))).toBe(true);
        expect(names.some(n => n.includes('battery'))).toBe(true);
        expect(names.some(n => n.includes('swap'))).toBe(true);
        expect(names.some(n => n.includes('user'))).toBe(true);
    });

    it('Logged-in Users preset exists and uses javascript type', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Logged-in Users');
        expect(preset).toBeDefined();
        expect(preset.type).toBe(MonitorType.JAVASCRIPT);
        expect(preset.command).toContain('who');
    });

    it('Battery Time Remaining preset exists and shows AC on mains — ISSUE 63', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Battery Time Remaining');
        expect(preset).toBeDefined();
        expect(preset.type).toBe(MonitorType.JAVASCRIPT);
        expect(preset.command).toContain('Discharging');
        expect(preset.command).toContain('energy_now');
        expect(preset.command).toContain('AC');
        expect(preset.showSparkline).toBe(false);
    });

    it('Battery Time Remaining falls back to charge_now/current_now — ISSUE 63', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Battery Time Remaining');
        expect(preset.command).toContain('charge_now');
        expect(preset.command).toContain('current_now');
    });

    it('Battery Time Remaining has CAUTION <1h and DANGER <30m — ISSUE 85', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Battery Time Remaining');
        expect(preset.cautionPatterns).toContain('<1h');
        expect(preset.dangerPatterns).toContain('<30m');
    });

    it('Claude Usage preset exists with correct structure — ISSUE 86', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Claude Usage');
        expect(preset).toBeDefined();
        expect(preset.type).toBe(MonitorType.JAVASCRIPT);
        expect(preset.intervalSeconds).toBe(0);
        expect(preset.showSparkline).toBe(false);
        expect(preset.command).toContain('.credentials.json');
        expect(preset.command).toContain('api.anthropic.com');
        expect(preset.command).toContain('five_hour');
        expect(preset.command).toContain('seven_day');
    });

    it('Claude Usage CAUTION pattern matches 75–100%, DANGER matches 90–100% — ISSUE 86', () => {
        const p = PRESET_MONITORS.find(pr => pr.name === 'Claude Usage');
        const cautionRe = new RegExp(p.cautionPatterns[0]);
        const dangerRe  = new RegExp(p.dangerPatterns[0]);
        // CAUTION: ≥75%
        expect(cautionRe.test('5h: 75%\n7d: 50%')).toBe(true);
        expect(cautionRe.test('5h: 80%\n7d: 60%')).toBe(true);
        expect(cautionRe.test('5h: 74%\n7d: 74%')).toBe(false);
        // DANGER: ≥90%
        expect(dangerRe.test('5h: 90%\n7d: 50%')).toBe(true);
        expect(dangerRe.test('5h: 100%\n7d: 50%')).toBe(true);
        expect(dangerRe.test('5h: 89%\n7d: 89%')).toBe(false);
    });

    it('OpenRouter preset exists with correct structure — ISSUE 87', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'OpenRouter');
        expect(preset).toBeDefined();
        expect(preset.type).toBe(MonitorType.JAVASCRIPT);
        expect(preset.intervalSeconds).toBe(0);
        expect(preset.showSparkline).toBe(false);
        expect(preset.command).toContain('openrouter.ai');
        expect(preset.command).toContain('/credits');
        expect(preset.command).toContain('/activity');
        expect(preset.command).toContain('Balance: $');
    });

    it('OpenRouter CAUTION pattern matches balance <$10, DANGER <$5 — ISSUE 87', () => {
        const p = PRESET_MONITORS.find(pr => pr.name === 'OpenRouter');
        const cautionRe = new RegExp(p.cautionPatterns[0]);
        const dangerRe  = new RegExp(p.dangerPatterns[0]);
        // CAUTION: balance $0–$9.99
        expect(cautionRe.test('Balance: $8.50\nActivity (30d): 10 req / $2.00')).toBe(true);
        expect(cautionRe.test('Balance: $0.50\nActivity (30d): 10 req / $2.00')).toBe(true);
        expect(cautionRe.test('Balance: $10.00\nActivity (30d): 10 req / $2.00')).toBe(false);
        // DANGER: balance $0–$4.99
        expect(dangerRe.test('Balance: $4.99\nActivity (30d): 10 req / $2.00')).toBe(true);
        expect(dangerRe.test('Balance: $0.01\nActivity (30d): 10 req / $2.00')).toBe(true);
        expect(dangerRe.test('Balance: $5.00\nActivity (30d): 10 req / $2.00')).toBe(false);
        expect(dangerRe.test('Balance: $9.99\nActivity (30d): 10 req / $2.00')).toBe(false);
    });

    it('Claude Usage and OpenRouter are on-demand — ISSUE 112', () => {
        // ISSUE 112: expression-based scheduling removed; presets set to on-demand (intervalSeconds 0).
        for (const name of ['Claude Usage', 'OpenRouter']) {
            const preset = PRESET_MONITORS.find(p => p.name === name);
            expect(preset).toBeDefined();
            expect(preset.intervalSeconds).toBe(0);
            expect(preset.intervalExpression ?? '').toBe('');
        }
    });

    it('CPU Power (RAPL) preset has helpText with setup instructions — ISSUE 68', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'CPU Power (RAPL)');
        expect(typeof preset.helpText).toBe('string');
        expect(preset.helpText.trim().length).toBeGreaterThan(0);
        // Must include both setup options so users can pick persistent or temporary.
        expect(preset.helpText).toContain('chmod');
        expect(preset.helpText).toContain('udev');
    });

    it('CPU Power (RAPL) preset exists with help text — ISSUE 62', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'CPU Power (RAPL)');
        expect(preset).toBeDefined();
        expect(preset.type).toBe(MonitorType.JAVASCRIPT);
        // Command must read energy_uj twice and compute watts.
        expect(preset.command).toContain('energy_uj');
        expect(preset.command).toContain('GLib.usleep');
        expect(preset.command).toContain('watts');
        // Description must include the chmod/udev help text.
        expect(preset.description).toContain('chmod');
    });

    it('Last Login preset exists with no sparkline — ISSUE 60', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Last Login');
        expect(preset).toBeDefined();
        expect(preset.type).toBe(MonitorType.JAVASCRIPT);
        expect(preset.command).toContain('last -n 1');
        expect(preset.showSparkline).toBe(false);
    });

    it('Last Login command extracts user, tty and date from last output — ISSUE 60', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Last Login');
        expect(preset.command).toContain('wtmp');  // filters wtmp header line
        expect(preset.command).toMatch(/user.*tty|p\[0\].*p\[1\]/s);
    });

    it('Gnome RDP command uses grdctl status (no --headless flag) — ISSUE 56', () => {
        // grdctl status --headless is not a valid subcommand; it causes grdctl to
        // exit non-zero so the [ok, out] check always fails, printing N/A.
        const preset = PRESET_MONITORS.find(p => p.name === 'Gnome RDP');
        expect(preset.command).not.toContain('--headless');
        expect(preset.command).toContain('grdctl status');
    });

    it('Gnome RDP Enable/Disable actions have guards — ISSUE 64', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Gnome RDP');
        const enable  = (preset.actions ?? []).find(a => a.label === 'Enable');
        const disable = (preset.actions ?? []).find(a => a.label === 'Disable');
        // Enable guard: show only when RDP is currently disabled.
        expect(enable.guard).toBeTruthy();
        expect(enable.guard).toContain('disabled');
        // Disable guard: show only when RDP is currently enabled.
        expect(disable.guard).toBeTruthy();
        expect(disable.guard).toContain('enabled');
    });

    it('Gnome RDP preset exists with correct properties — ISSUE 51', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Gnome RDP');
        expect(preset).toBeDefined();
        expect(preset.type).toBe(MonitorType.JAVASCRIPT);
        expect(preset.command).toContain('grdctl');
        expect(preset.cautionPatterns).toContain('enabled');
        const enable  = (preset.actions ?? []).find(a => a.label === 'Enable');
        const disable = (preset.actions ?? []).find(a => a.label === 'Disable');
        expect(enable).toBeDefined();
        expect(disable).toBeDefined();
        expect(enable.command).toContain('grdctl rdp enable');
        expect(disable.command).toContain('grdctl rdp disable');
    });

    it('Logged-in Users preset has showSparkline: false — ISSUE 55', () => {
        // Multi-line user list; a sparkline (unique user count) is not meaningful.
        const preset = PRESET_MONITORS.find(p => p.name === 'Logged-in Users');
        expect(preset.showSparkline).toBe(false);
    });

    it('Logged-in Users output is multiline NAME: HOW format — ISSUE 49', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Logged-in Users');
        // Groups login methods per user: "tom: seat0, tty2" one line per user
        expect(preset.command).toContain('byUser');
        // Login methods joined with ", " and users joined with newline
        expect(preset.command).toContain('join(\', \')');
        expect(preset.command).toContain('join(\'\\n\')');
    });

    it('every preset has a non-empty description string', () => {
        for (const preset of PRESET_MONITORS) {
            expect(typeof preset.description).toBe('string');
            expect(preset.description.trim().length).toBeGreaterThan(0);
        }
    });

    it('Top CPU/MEM Processes commands separate entries with newlines', () => {
        const cpuPreset = PRESET_MONITORS.find(p => p.name === 'Top CPU Processes');
        const memPreset = PRESET_MONITORS.find(p => p.name === 'Top MEM Processes');
        // Each process should be on its own line (\n in the awk printf format)
        expect(cpuPreset.command).toContain('\\n');
        expect(memPreset.command).toContain('\\n');
    });

    it('Top CPU/MEM Processes commands extract basename, not substr of full path', () => {
        const cpuPreset = PRESET_MONITORS.find(p => p.name === 'Top CPU Processes');
        const memPreset = PRESET_MONITORS.find(p => p.name === 'Top MEM Processes');
        // Must not use substr($11,...) which truncates but keeps directory prefix
        expect(cpuPreset.command).not.toContain('substr($11');
        expect(memPreset.command).not.toContain('substr($11');
    });

    it('RAM Free preset uses MemFree, not MemAvailable — ISSUE 72', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'RAM Free');
        expect(preset).toBeDefined();
        // Must read MemFree from /proc/meminfo (the "free" column of free -h)
        expect(preset.command).toContain('MemFree');
        expect(preset.command).not.toContain('MemAvailable');
    });

    it('RAM Free description mentions free -h — ISSUE 72', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'RAM Free');
        expect(preset.description).toMatch(/free -h/i);
    });

    it('CPU Usage, Net Download, Net Upload use javascript type', () => {
        const jsPresets = ['CPU Usage', 'Net Download', 'Net Upload'];
        for (const name of jsPresets) {
            const preset = PRESET_MONITORS.find(p => p.name === name);
            expect(preset).toBeDefined();
            expect(preset.type).toBe(MonitorType.JAVASCRIPT);
        }
    });

    it('all presets use javascript type', () => {
        // All presets are now implemented in GJS so no external tools are needed.
        for (const preset of PRESET_MONITORS) {
            expect(preset.type).toBe(MonitorType.JAVASCRIPT);
        }
    });

    it('Claude Usage has AI_AGENT arg with ^(claude)$ default — ISSUE 94', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Claude Usage');
        const arg = (preset.args ?? []).find(a => a.name === 'AI_AGENT');
        expect(arg).toBeDefined();
        expect(arg.default).toBe('^(claude)$');
    });

    it('Claude Usage has no intervalExpression — ISSUE 112 removed expression scheduling', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Claude Usage');
        expect(preset.intervalExpression ?? '').toBe('');
    });

    it('Claude Usage command includes reset time in output — ISSUE 106', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Claude Usage');
        // Command must read reset timestamp from the API response.
        expect(preset.command).toMatch(/resets_at|reset_at|resetsAt/);
        // Output line must include "(reset: …)" so the user sees when quota refreshes.
        expect(preset.command).toContain('(reset:');
    });

    it('OpenRouter Activity line shows only $ amount, not req count — ISSUE 107', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'OpenRouter');
        // Activity output must contain the spend amount but NOT the request count.
        expect(preset.command).toContain('Activity (30d): $');
        expect(preset.command).not.toContain('req /');
    });

    it('OpenRouter has AI_AGENT arg with ^(opencode)$ default — ISSUE 95', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'OpenRouter');
        const arg = (preset.args ?? []).find(a => a.name === 'AI_AGENT');
        expect(arg).toBeDefined();
        expect(arg.default).toBe('^(opencode)$');
    });

    it('OpenRouter has no intervalExpression — ISSUE 112 removed expression scheduling', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'OpenRouter');
        expect(preset.intervalExpression ?? '').toBe('');
    });
});

// ---------------------------------------------------------------------------
// Source-level regression tests (ISSUE 32)
// GLib.file_get_contents throws on missing files in GJS — verify that
// all preset scripts guard reads with try/catch, not the broken [ok, b] pattern.
// ---------------------------------------------------------------------------
describe('preset GJS scripts: GLib.file_get_contents error handling', () => {
    it('thermalJS guards the file read with try/catch (thermal_zone may not exist)', () => {
        // If [ok, b] + if (!ok) were used instead, missing thermal_zone1 exits 1.
        const thermalPreset = PRESET_MONITORS.find(p => p.name === 'Thermal Zone 1');
        expect(thermalPreset.command).toContain('try {');
        expect(thermalPreset.command).toContain('} catch (_)');
        expect(thermalPreset.command).not.toMatch(/const \[ok,/);
    });

    it('Thermal Zone 0 preset exists with correct command and error guard — ISSUE 42', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Thermal Zone 0');
        expect(preset).toBeDefined();
        expect(preset.type).toBe(MonitorType.JAVASCRIPT);
        expect(preset.command).toContain('thermal_zone0');
        expect(preset.command).toContain('try {');
        expect(preset.command).toContain('} catch (_)');
    });

    it('_readFile in process presets guards reads with try/catch (proc entries race)', () => {
        // Processes exit between _listPids() and reading their /proc entries.
        // The [ok, b] + null-return pattern does not protect against a throw.
        const memPreset = PRESET_MONITORS.find(p => p.name === 'Top MEM Processes');
        const cpuPreset = PRESET_MONITORS.find(p => p.name === 'Top CPU Processes');
        for (const preset of [memPreset, cpuPreset]) {
            expect(preset.command).toContain('try {');
            expect(preset.command).toContain('} catch (_)');
        }
    });

    it('Top CPU Processes EXCLUDE arg defaults to ^(gjs)$ — ISSUE 48', () => {
        const cpu = PRESET_MONITORS.find(p => p.name === 'Top CPU Processes');
        const excludeArg = (cpu.args ?? []).find(a => a.name === 'EXCLUDE');
        expect(excludeArg).toBeDefined();
        expect(excludeArg.default).toBe('^(gjs)$');
    });

    it('Top MEM Processes EXCLUDE arg defaults to gjs (unchanged)', () => {
        const mem = PRESET_MONITORS.find(p => p.name === 'Top MEM Processes');
        const excludeArg = (mem.args ?? []).find(a => a.name === 'EXCLUDE');
        expect(excludeArg).toBeDefined();
        expect(excludeArg.default).toBe('gjs');
    });

    it('Top MEM Processes formats memory as MB/GB, not percentage — ISSUE 38', () => {
        const mem = PRESET_MONITORS.find(p => p.name === 'Top MEM Processes');
        // Must use _fmtMem helper that produces MB/GB strings
        expect(mem.command).toContain('_fmtMem');
        // Must NOT use the old percentage formula
        expect(mem.command).not.toContain('memTotal * 100');
    });

    it('Top CPU/MEM Processes have a COUNT arg with default 3 — ISSUE 61', () => {
        for (const name of ['Top CPU Processes', 'Top MEM Processes']) {
            const preset = PRESET_MONITORS.find(p => p.name === name);
            const countArg = (preset.args ?? []).find(a => a.name === 'COUNT');
            expect(countArg).toBeDefined();
            expect(countArg.default).toBe('3');
        }
    });

    it('Top CPU/MEM commands use _count variable for slice limit — ISSUE 61', () => {
        const cpu = PRESET_MONITORS.find(p => p.name === 'Top CPU Processes');
        const mem = PRESET_MONITORS.find(p => p.name === 'Top MEM Processes');
        for (const preset of [cpu, mem]) {
            expect(preset.command).toContain('_count');
            expect(preset.command).toContain('slice(0, _count)');
            // Must not use the hardcoded literal 3 in the slice call.
            expect(preset.command).not.toContain('slice(0, 3)');
        }
    });

    it('Top CPU/MEM Processes commands check EXCLUDE variable for filtering', () => {
        const cpu = PRESET_MONITORS.find(p => p.name === 'Top CPU Processes');
        const mem = PRESET_MONITORS.find(p => p.name === 'Top MEM Processes');
        for (const preset of [cpu, mem]) {
            expect(preset.command).toContain('EXCLUDE');
            expect(preset.command).toContain('_exclude');
        }
    });

    it('Battery Level guards each per-entry read with inner try/catch (AC has no capacity file)', () => {
        // The outer try/catch alone was swallowing the error before BAT0 was reached.
        // The inner try/catch must be present so non-battery entries are skipped.
        const batteryPreset = PRESET_MONITORS.find(p => p.name === 'Battery Level');
        // Two independent try blocks: outer (enumerate) + inner (per-entry read)
        const tryCount = (batteryPreset.command.match(/\btry\s*\{/g) ?? []).length;
        expect(tryCount).toBeGreaterThanOrEqual(2);
        expect(batteryPreset.command).not.toMatch(/const \[ok,/);
    });
});
