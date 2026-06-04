/**
 * Regression tests for metadata.json.
 * Ensures the extension declares compatibility with the GNOME Shell versions
 * it actually supports, preventing silent incompatibility errors in the
 * Extension Manager.
 */

import {readFileSync} from 'fs';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';
import {describe, it, expect} from '@jest/globals';

const __dirname = dirname(fileURLToPath(import.meta.url));
const metadata = JSON.parse(readFileSync(join(__dirname, '..', 'metadata.json'), 'utf8'));

describe('metadata.json', () => {
    it('declares a uuid', () => {
        expect(typeof metadata.uuid).toBe('string');
        expect(metadata.uuid.length).toBeGreaterThan(0);
    });

    it('includes GNOME Shell 50 in shell-version', () => {
        // Regression: extension was missing "50", causing Extension Manager to
        // report it as incompatible on GNOME 50.
        expect(metadata['shell-version']).toContain('50');
    });

    it('includes all declared shell versions as strings', () => {
        // GNOME Extension Manager requires version strings, not numbers.
        for (const v of metadata['shell-version']) {
            expect(typeof v).toBe('string');
        }
    });

    it('omits session-modes — ISSUE 129', () => {
        // EGO-M-005: field must be omitted when it only contains "user" (the default).
        expect(metadata['session-modes']).toBeUndefined();
    });
});
