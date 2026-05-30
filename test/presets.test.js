/**
 * Unit tests for lib/presets.js.
 * Verifies that every preset has the required shape and sane defaults.
 */

import {PRESET_MONITORS} from '../lib/presets.js';
import {validateMonitor} from '../lib/monitor.js';

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
        // Must include CPU, RAM/memory, battery, swap
        expect(names.some(n => n.includes('cpu'))).toBe(true);
        expect(names.some(n => n.includes('ram') || n.includes('mem'))).toBe(true);
        expect(names.some(n => n.includes('battery'))).toBe(true);
        expect(names.some(n => n.includes('swap'))).toBe(true);
    });

    it('every preset has a non-empty description string', () => {
        for (const preset of PRESET_MONITORS) {
            expect(typeof preset.description).toBe('string');
            expect(preset.description.trim().length).toBeGreaterThan(0);
        }
    });
});
