/**
 * Regression tests for stylesheet.css.
 * Guards visual invariants that can't be caught by JS unit tests.
 */

import {readFileSync} from 'fs';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';
import {describe, it, expect} from '@jest/globals';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, '..', 'stylesheet.css'), 'utf8');

describe('stylesheet.css — status value colours', () => {
    // Regression: ISSUE 81 — status is indicated by icon colour (inline style) and
    // value label colour (CSS).  Guard the CSS value-label rules so they are not
    // accidentally removed.
    it('colours value label for caution rows', () => {
        expect(css).toMatch(/\.monish-status-caution\s+\.monish-monitor-value\s*\{[^}]*color\s*:\s*#e5a50a/);
    });

    it('colours value label for danger rows', () => {
        expect(css).toMatch(/\.monish-status-danger\s+\.monish-monitor-value\s*\{[^}]*color\s*:\s*#e01b24/);
    });

    it('colours value label for error rows', () => {
        expect(css).toMatch(/\.monish-status-error\s+\.monish-monitor-value\s*\{[^}]*color\s*:\s*#c64600/);
    });
});
