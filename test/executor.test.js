/**
 * Source-level regression tests for lib/executor.js.
 * The module uses GJS gi:// imports so it cannot be loaded in Node.js;
 * these tests inspect the source text instead.
 */

import {readFileSync} from 'fs';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';
import {describe, it, expect} from '@jest/globals';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const execSource  = readFileSync(join(__dirname, '..', 'lib', 'executor.js'), 'utf8');

describe('executor.js GJS command flag', () => {
    it('uses -c not -e to invoke inline code (GJS >= 1.80 renamed --eval to --command)', () => {
        // GJS 1.88 removed -e / --eval; -c / --command is required.
        expect(execSource).toContain('\'-c\'');
    });

    it('does not use the removed -e flag', () => {
        expect(execSource).not.toContain('\'-e\'');
    });
});
