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

describe('stylesheet.css — action icon border colours', () => {
    // Regression: ISSUE 79 — border must match the row's status colour so the
    // overlay is visually coherent instead of a fixed arbitrary blue.
    it('overrides border-color for caution rows', () => {
        expect(css).toMatch(/\.monish-status-caution\s+\.monish-action-icon\s*\{[^}]*border-color\s*:\s*#e5a50a/);
    });

    it('overrides border-color for danger rows', () => {
        expect(css).toMatch(/\.monish-status-danger\s+\.monish-action-icon\s*\{[^}]*border-color\s*:\s*#e01b24/);
    });

    it('overrides border-color for error rows', () => {
        expect(css).toMatch(/\.monish-status-error\s+\.monish-action-icon\s*\{[^}]*border-color\s*:\s*#c64600/);
    });
});
