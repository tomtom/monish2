/**
 * Unit tests for lib/monitor.js.
 * All tests use Node.js CommonJS-compatible imports via the ES module import.
 * These tests define the contract for pure monitor logic.
 */

import {
    MonitorStatus,
    MonitorType,
    parseValue,
    evaluateStatus,
    matchesPattern,
    intervalToMs,
    jitteredInterval,
    deserializeMonitors,
    serializeMonitors,
    validateMonitor,
    createMonitor,
    formatError,
    splitInterval,
    toSeconds,
    extractNumber,
    buildSparkline,
    SPARKLINE_CHARS,
    SPARKLINE_MAX_VALUES,
    injectArgs,
} from '../lib/monitor.js';

import {describe, it, expect} from '@jest/globals';

// ---------------------------------------------------------------------------
// parseValue
// ---------------------------------------------------------------------------

describe('parseValue', () => {
    it('returns trimmed raw output when no regex given', () => {
        expect(parseValue('  42%  ', '')).toBe('42%');
        expect(parseValue('hello\n', null)).toBe('hello');
    });

    it('returns full match when regex has no capture group', () => {
        expect(parseValue('cpu 87.3%', '\\d+\\.\\d+%')).toBe('87.3%');
    });

    it('returns capture group 1 when regex has one group', () => {
        expect(parseValue('cpu 87.3%', 'cpu (\\d+\\.\\d+)%')).toBe('87.3');
    });

    it('returns first capture group when multiple groups present', () => {
        expect(parseValue('used: 3G total: 8G', 'used: (\\w+) total: (\\w+)')).toBe('3G');
    });

    it('returns raw output when regex does not match', () => {
        expect(parseValue('no numbers here', '(\\d+)')).toBe('no numbers here');
    });

    it('returns raw output on invalid regex', () => {
        expect(parseValue('hello', '[')).toBe('hello');
    });
});

// ---------------------------------------------------------------------------
// matchesPattern
// ---------------------------------------------------------------------------

describe('matchesPattern', () => {
    it('returns false for empty/null pattern', () => {
        expect(matchesPattern('50', '')).toBe(false);
        expect(matchesPattern('50', null)).toBe(false);
        expect(matchesPattern('50', undefined)).toBe(false);
    });

    it('matches numeric range inclusive', () => {
        expect(matchesPattern('70', '60-80')).toBe(true);
        expect(matchesPattern('60', '60-80')).toBe(true);
        expect(matchesPattern('80', '60-80')).toBe(true);
        expect(matchesPattern('59', '60-80')).toBe(false);
        expect(matchesPattern('81', '60-80')).toBe(false);
    });

    it('matches float in numeric range', () => {
        expect(matchesPattern('72.5', '70-80')).toBe(true);
        expect(matchesPattern('72.5', '70.0-75.0')).toBe(true);
    });

    it('matches > comparison', () => {
        expect(matchesPattern('91', '>90')).toBe(true);
        expect(matchesPattern('90', '>90')).toBe(false);
    });

    it('matches >= comparison', () => {
        expect(matchesPattern('90', '>=90')).toBe(true);
        expect(matchesPattern('89', '>=90')).toBe(false);
    });

    it('matches < comparison', () => {
        expect(matchesPattern('5', '<10')).toBe(true);
        expect(matchesPattern('10', '<10')).toBe(false);
    });

    it('matches <= comparison', () => {
        expect(matchesPattern('10', '<=10')).toBe(true);
        expect(matchesPattern('11', '<=10')).toBe(false);
    });

    it('matches = comparison', () => {
        expect(matchesPattern('42', '=42')).toBe(true);
        expect(matchesPattern('43', '=42')).toBe(false);
    });

    it('falls back to regex match for string patterns', () => {
        expect(matchesPattern('critical', 'crit')).toBe(true);
        expect(matchesPattern('critical', '^critical$')).toBe(true);
        expect(matchesPattern('ok', '^critical$')).toBe(false);
    });

    it('matches exact string when regex is invalid', () => {
        // invalid regex "[" falls back to exact string compare
        expect(matchesPattern('[', '[')).toBe(true);
        expect(matchesPattern('x', '[')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// evaluateStatus
// ---------------------------------------------------------------------------

describe('evaluateStatus', () => {
    it('returns normal when no patterns match', () => {
        expect(evaluateStatus('50', ['>70'], ['>90'])).toBe(MonitorStatus.NORMAL);
    });

    it('returns caution when caution pattern matches', () => {
        expect(evaluateStatus('75', ['>70'], ['>90'])).toBe(MonitorStatus.CAUTION);
    });

    it('returns danger when danger pattern matches', () => {
        expect(evaluateStatus('95', ['>70'], ['>90'])).toBe(MonitorStatus.DANGER);
    });

    it('danger takes precedence over caution when both match', () => {
        // danger checked first — both patterns ">70" and ">90" match value "95"
        expect(evaluateStatus('95', ['>70'], ['>90'])).toBe(MonitorStatus.DANGER);
    });

    it('returns normal with empty pattern arrays', () => {
        expect(evaluateStatus('999', [], [])).toBe(MonitorStatus.NORMAL);
    });

    it('returns normal when pattern arrays are null/undefined', () => {
        expect(evaluateStatus('999', null, null)).toBe(MonitorStatus.NORMAL);
    });
});

// ---------------------------------------------------------------------------
// intervalToMs
// ---------------------------------------------------------------------------

describe('intervalToMs', () => {
    it('converts seconds', () => {
        expect(intervalToMs(5, 'seconds')).toBe(5000);
    });

    it('converts minutes', () => {
        expect(intervalToMs(2, 'minutes')).toBe(120000);
    });

    it('converts hours', () => {
        expect(intervalToMs(1, 'hours')).toBe(3600000);
    });

    it('defaults to seconds for unknown unit', () => {
        expect(intervalToMs(3, 'unknown')).toBe(3000);
    });
});

// ---------------------------------------------------------------------------
// serialize / deserialize
// ---------------------------------------------------------------------------

describe('serializeMonitors / deserializeMonitors', () => {
    const monitors = [
        {id: 'a', name: 'CPU', command: 'top', intervalSeconds: 5},
    ];

    it('round-trips a monitor array', () => {
        expect(deserializeMonitors(serializeMonitors(monitors))).toEqual(monitors);
    });

    it('returns empty array on invalid JSON', () => {
        expect(deserializeMonitors('not json')).toEqual([]);
    });

    it('returns empty array on non-array JSON', () => {
        expect(deserializeMonitors('{"key":"value"}')).toEqual([]);
    });

    it('returns empty array on empty string', () => {
        expect(deserializeMonitors('')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// validateMonitor
// ---------------------------------------------------------------------------

describe('validateMonitor', () => {
    const valid = {
        id: 'x',
        name: 'CPU',
        command: 'top -bn1',
        intervalSeconds: 10,
        outputRegex: '',
        cautionPatterns: [],
        dangerPatterns: [],
        enabled: true,
    };

    it('returns no errors for valid monitor', () => {
        expect(validateMonitor(valid)).toEqual([]);
    });

    it('errors on missing name', () => {
        expect(validateMonitor({...valid, name: ''})).toContain('Name is required');
    });

    it('errors on missing command', () => {
        expect(validateMonitor({...valid, command: ''})).toContain('Command is required');
    });

    it('accepts interval of 0 (disabled monitor)', () => {
        // 0 is valid: it means the monitor is intentionally deactivated.
        expect(validateMonitor({...valid, intervalSeconds: 0})).toEqual([]);
    });

    it('errors on negative interval', () => {
        expect(validateMonitor({...valid, intervalSeconds: -1})).toContain(
            'Interval must be 0 (disabled) or a positive number of seconds',
        );
    });

    it('errors on null interval', () => {
        expect(validateMonitor({...valid, intervalSeconds: null})).toContain(
            'Interval must be 0 (disabled) or a positive number of seconds',
        );
    });
});

// ---------------------------------------------------------------------------
// createMonitor
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------

describe('formatError', () => {
    it('returns "timeout" for timeout errors', () => {
        expect(formatError(new Error('timeout'))).toBe('timeout');
    });

    it('returns the error message for regular errors', () => {
        expect(formatError(new Error('gjs not found in PATH'))).toBe('gjs not found in PATH');
    });

    it('returns only the first line for multi-line messages', () => {
        expect(formatError(new Error('line1\nline2\nline3'))).toBe('line1');
    });

    it('truncates messages longer than 80 chars with ellipsis', () => {
        const msg = 'a'.repeat(100);
        const result = formatError(new Error(msg));
        expect(result.length).toBe(80);
        expect(result.endsWith('...')).toBe(true);
    });

    it('returns "error" for empty message', () => {
        expect(formatError(new Error(''))).toBe('error');
    });
});

describe('MonitorType', () => {
    it('has SHELL and JAVASCRIPT values', () => {
        expect(MonitorType.SHELL).toBe('shell');
        expect(MonitorType.JAVASCRIPT).toBe('javascript');
    });

    it('is frozen', () => {
        expect(Object.isFrozen(MonitorType)).toBe(true);
    });
});

describe('createMonitor', () => {
    it('creates a monitor with required defaults', () => {
        const m = createMonitor({name: 'Test', command: 'echo hi'});
        expect(m.name).toBe('Test');
        expect(m.command).toBe('echo hi');
        expect(m.intervalSeconds).toBe(60);
        expect(m.enabled).toBe(true);
        expect(typeof m.id).toBe('string');
        expect(m.id.length).toBeGreaterThan(0);
    });

    it('defaults type to shell', () => {
        expect(createMonitor().type).toBe(MonitorType.SHELL);
    });

    it('allows overriding type to javascript', () => {
        const m = createMonitor({type: MonitorType.JAVASCRIPT});
        expect(m.type).toBe(MonitorType.JAVASCRIPT);
    });

    it('generates unique IDs', () => {
        const ids = new Set(Array.from({length: 100}, () => createMonitor().id));
        expect(ids.size).toBe(100);
    });

    it('overrides default fields', () => {
        const m = createMonitor({intervalSeconds: 60, enabled: false});
        expect(m.intervalSeconds).toBe(60);
        expect(m.enabled).toBe(false);
    });

    it('defaults intervalSeconds to at least 60 seconds', () => {
        // Predefined monitors enforce PRESET_MIN_INTERVAL=60; the factory
        // default must match so new monitors also start at a sane interval.
        expect(createMonitor().intervalSeconds).toBeGreaterThanOrEqual(60);
    });

    it('defaults onDemand to false', () => {
        expect(createMonitor().onDemand).toBe(false);
    });

    it('defaults onDemandValidSeconds to 60', () => {
        expect(createMonitor().onDemandValidSeconds).toBe(60);
    });

    it('allows overriding onDemand to true', () => {
        expect(createMonitor({onDemand: true}).onDemand).toBe(true);
    });

    it('allows overriding onDemandValidSeconds', () => {
        expect(createMonitor({onDemandValidSeconds: 300}).onDemandValidSeconds).toBe(300);
    });
});

// ---------------------------------------------------------------------------
// jitteredInterval
// ---------------------------------------------------------------------------

describe('jitteredInterval', () => {
    it('returns exact interval when jitter is 0', () => {
        expect(jitteredInterval(10000, 0)).toBe(10000);
    });

    it('returns exact interval when jitter is null', () => {
        expect(jitteredInterval(10000, null)).toBe(10000);
    });

    it('returns exact interval when jitter is undefined', () => {
        expect(jitteredInterval(10000, undefined)).toBe(10000);
    });

    it('returns value within ±jitter% of the base interval', () => {
        const base = 10000;
        const pct  = 10;
        for (let i = 0; i < 200; i++) {
            const result = jitteredInterval(base, pct);
            expect(result).toBeGreaterThanOrEqual(base * (1 - pct / 100));
            expect(result).toBeLessThanOrEqual(base * (1 + pct / 100));
        }
    });

    it('never returns less than 1000 ms', () => {
        // Even with a very short base interval + max jitter, minimum is 1s.
        for (let i = 0; i < 200; i++) {
            expect(jitteredInterval(500, 50)).toBeGreaterThanOrEqual(1000);
        }
    });
});

// ---------------------------------------------------------------------------
// splitInterval
// ---------------------------------------------------------------------------

describe('splitInterval', () => {
    it('splits 1 second as seconds', () => {
        expect(splitInterval(1)).toEqual({magnitude: 1, unit: 'seconds'});
    });

    it('splits 30 seconds as seconds', () => {
        expect(splitInterval(30)).toEqual({magnitude: 30, unit: 'seconds'});
    });

    it('splits 60 seconds as 1 minute', () => {
        expect(splitInterval(60)).toEqual({magnitude: 1, unit: 'minutes'});
    });

    it('splits 120 seconds as 2 minutes', () => {
        expect(splitInterval(120)).toEqual({magnitude: 2, unit: 'minutes'});
    });

    it('splits 3600 seconds as 1 hour', () => {
        expect(splitInterval(3600)).toEqual({magnitude: 1, unit: 'hours'});
    });

    it('splits 7200 seconds as 2 hours', () => {
        expect(splitInterval(7200)).toEqual({magnitude: 2, unit: 'hours'});
    });

    it('falls back to seconds when not evenly divisible by 60', () => {
        expect(splitInterval(90)).toEqual({magnitude: 90, unit: 'seconds'});
    });

    it('defaults to 1 minute for 0 — prevents showing "0 minutes"', () => {
        expect(splitInterval(0)).toEqual({magnitude: 1, unit: 'minutes'});
    });

    it('defaults to 1 minute for null', () => {
        expect(splitInterval(null)).toEqual({magnitude: 1, unit: 'minutes'});
    });

    it('defaults to 1 minute for undefined', () => {
        expect(splitInterval(undefined)).toEqual({magnitude: 1, unit: 'minutes'});
    });

    it('defaults to 1 minute for NaN', () => {
        expect(splitInterval(NaN)).toEqual({magnitude: 1, unit: 'minutes'});
    });

    it('defaults to 1 minute for negative values', () => {
        expect(splitInterval(-60)).toEqual({magnitude: 1, unit: 'minutes'});
    });
});

// ---------------------------------------------------------------------------
// toSeconds
// ---------------------------------------------------------------------------

describe('toSeconds', () => {
    it('converts seconds', () => {
        expect(toSeconds(5, 'seconds')).toBe(5);
    });

    it('converts minutes', () => {
        expect(toSeconds(2, 'minutes')).toBe(120);
    });

    it('converts hours', () => {
        expect(toSeconds(1, 'hours')).toBe(3600);
    });

    it('is the inverse of splitInterval for round values', () => {
        expect(toSeconds(1, 'minutes')).toBe(60);
        expect(toSeconds(1, 'hours')).toBe(3600);
    });

    it('defaults to seconds for unknown unit', () => {
        expect(toSeconds(5, 'unknown')).toBe(5);
    });
});

// ---------------------------------------------------------------------------
// extractNumber
// ---------------------------------------------------------------------------

describe('extractNumber', () => {
    it('extracts integer from plain number string', () => {
        expect(extractNumber('42')).toBe(42);
    });

    it('extracts decimal from value with unit', () => {
        expect(extractNumber('3.14 GHz')).toBeCloseTo(3.14);
    });

    it('extracts first number from mixed string', () => {
        expect(extractNumber('CPU 87% idle')).toBe(87);
    });

    it('extracts negative number', () => {
        expect(extractNumber('-5.2')).toBeCloseTo(-5.2);
    });

    it('returns NaN for strings with no number', () => {
        expect(extractNumber('idle')).toBeNaN();
        expect(extractNumber('')).toBeNaN();
    });

    it('returns NaN for null/undefined', () => {
        expect(extractNumber(null)).toBeNaN();
        expect(extractNumber(undefined)).toBeNaN();
    });
});

// ---------------------------------------------------------------------------
// buildSparkline
// ---------------------------------------------------------------------------

describe('buildSparkline', () => {
    it('returns empty string for empty array', () => {
        expect(buildSparkline([])).toBe('');
    });

    it('returns single char for single value', () => {
        const spark = buildSparkline([50]);
        expect(spark).toHaveLength(1);
        expect(SPARKLINE_CHARS).toContain(spark);
    });

    it('min value maps to first char (▁)', () => {
        const spark = buildSparkline([0, 50, 100]);
        expect(spark[0]).toBe(SPARKLINE_CHARS[0]);
    });

    it('max value maps to last char (█)', () => {
        const spark = buildSparkline([0, 50, 100]);
        expect(spark[2]).toBe(SPARKLINE_CHARS[7]);
    });

    it('all-equal values produce mid-height bars', () => {
        const spark = buildSparkline([42, 42, 42]);
        // All bars must be the same character at mid level (index 3 = ▄)
        expect(spark).toBe(SPARKLINE_CHARS[3].repeat(3));
    });

    it('length equals number of input values', () => {
        expect(buildSparkline([1, 2, 3, 4, 5])).toHaveLength(5);
    });

    it('all characters are valid sparkline chars', () => {
        const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        const spark = buildSparkline(values);
        for (const ch of spark) {
            expect(SPARKLINE_CHARS).toContain(ch);
        }
    });
});

describe('SPARKLINE_MAX_VALUES', () => {
    it('is 20', () => {
        expect(SPARKLINE_MAX_VALUES).toBe(20);
    });
});

// ---------------------------------------------------------------------------
// injectArgs
// ---------------------------------------------------------------------------

describe('injectArgs', () => {
    const JS   = MonitorType.JAVASCRIPT;
    const SH   = MonitorType.SHELL;
    const arg  = (name, label = name) => ({name, label});

    it('returns command unchanged when args is empty', () => {
        expect(injectArgs('echo hi', SH, [], {})).toBe('echo hi');
    });

    it('returns command unchanged when args is null', () => {
        expect(injectArgs('echo hi', SH, null, {})).toBe('echo hi');
    });

    it('prepends export for shell type', () => {
        const out = injectArgs('echo $FOO', SH, [arg('FOO')], {FOO: 'bar'});
        expect(out).toContain('export FOO=\'bar\';');
        expect(out.indexOf('export FOO=\'bar\'')).toBeLessThan(out.indexOf('echo $FOO'));
    });

    it('prepends const declaration for JS type', () => {
        const out = injectArgs('print(FOO)', JS, [arg('FOO')], {FOO: 'bar'});
        expect(out).toContain('const FOO = "bar";');
        expect(out.indexOf('const FOO')).toBeLessThan(out.indexOf('print(FOO)'));
    });

    it('uses JSON.stringify for JS (escapes quotes)', () => {
        const out = injectArgs('x', JS, [arg('V')], {V: 'say "hi"'});
        expect(out).toContain('const V = "say \\"hi\\"";');
    });

    it('escapes single quotes in shell values', () => {
        const out = injectArgs('x', SH, [arg('V')], {V: 'it\'s'});
        expect(out).toContain('export V=\'it\'\\\'\'s\';');
    });

    it('uses empty string when argValues is missing the key', () => {
        const out = injectArgs('x', SH, [arg('V')], {});
        expect(out).toContain('export V=\'\';');
    });

    it('uses empty string when argValues is null', () => {
        const out = injectArgs('x', SH, [arg('V')], null);
        expect(out).toContain('export V=\'\';');
    });

    it('injects multiple args in order', () => {
        const out = injectArgs('cmd', SH, [arg('A'), arg('B')], {A: '1', B: '2'});
        expect(out).toContain('export A=\'1\';');
        expect(out).toContain('export B=\'2\';');
        expect(out.indexOf('export A=\'1\'')).toBeLessThan(out.indexOf('export B=\'2\''));
    });
});

// ---------------------------------------------------------------------------
// createMonitor args defaults
// ---------------------------------------------------------------------------

describe('createMonitor args / argValues defaults', () => {
    it('initialises args to empty array', () => {
        expect(createMonitor().args).toEqual([]);
    });

    it('initialises argValues to empty object', () => {
        expect(createMonitor().argValues).toEqual({});
    });

    it('populates argValues from arg defaults when creating from preset', () => {
        const monitor = createMonitor({
            args: [{name: 'EXCLUDE', label: 'Exclude', default: 'gjs'}],
        });
        expect(monitor.argValues.EXCLUDE).toBe('gjs');
    });

    it('does not overwrite existing argValues with defaults', () => {
        const monitor = createMonitor({
            args:      [{name: 'X', label: 'X', default: 'preset'}],
            argValues: {X: 'custom'},
        });
        expect(monitor.argValues.X).toBe('custom');
    });
});
