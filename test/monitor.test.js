/**
 * Unit tests for lib/monitor.js.
 * All tests use Node.js CommonJS-compatible imports via the ES module import.
 * These tests define the contract for pure monitor logic.
 */

import {
    MonitorStatus,
    parseValue,
    evaluateStatus,
    matchesPattern,
    intervalToMs,
    deserializeMonitors,
    serializeMonitors,
    validateMonitor,
    createMonitor,
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

    it('errors on interval below 1', () => {
        expect(validateMonitor({...valid, intervalSeconds: 0})).toContain(
            'Interval must be at least 1 second',
        );
    });
});

// ---------------------------------------------------------------------------
// createMonitor
// ---------------------------------------------------------------------------

describe('createMonitor', () => {
    it('creates a monitor with required defaults', () => {
        const m = createMonitor({name: 'Test', command: 'echo hi'});
        expect(m.name).toBe('Test');
        expect(m.command).toBe('echo hi');
        expect(m.intervalSeconds).toBe(10);
        expect(m.enabled).toBe(true);
        expect(typeof m.id).toBe('string');
        expect(m.id.length).toBeGreaterThan(0);
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
});
