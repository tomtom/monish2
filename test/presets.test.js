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

    it('every preset has a positive intervalSeconds', () => {
        for (const preset of PRESET_MONITORS) {
            expect(typeof preset.intervalSeconds).toBe('number');
            expect(preset.intervalSeconds).toBeGreaterThanOrEqual(1);
        }
    });

    it(`every preset interval is at least PRESET_MIN_INTERVAL (${PRESET_MIN_INTERVAL}s)`, () => {
        for (const preset of PRESET_MONITORS) {
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

    it('Logged-in Users output is multiline NAME: HOW format — ISSUE 49', () => {
        const preset = PRESET_MONITORS.find(p => p.name === 'Logged-in Users');
        // Groups login methods per user: "tom: seat0, tty2" one line per user
        expect(preset.command).toContain('byUser');
        // Login methods joined with ", " and users joined with newline
        expect(preset.command).toContain("join(', ')");
        expect(preset.command).toContain("join('\\n')");
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
