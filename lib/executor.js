/**
 * GJS-specific command executor for monitor scripts.
 *
 * Spawns each command through /bin/bash with stdout/stderr capture.
 * A GLib timeout kills the process if it exceeds the allowed duration,
 * preventing hung monitors from blocking the shell.
 *
 * This module has no Node.js-compatible exports — it uses GJS gi:// imports.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/** Default kill timeout if the caller does not specify one. */
const DEFAULT_TIMEOUT_SECONDS = 30;

/**
 * GJS async wrapper injected around user JavaScript code.
 * Provides a GLib.MainLoop so await expressions work correctly.
 * The user code is the body of an async IIFE; it should print() its result.
 */
const JS_ASYNC_WRAPPER_PREFIX = `
const GLib = imports.gi.GLib;
const _ml = GLib.MainLoop.new(null, false);
let _exitCode = 0;
(async () => {
`.trimStart();

const JS_ASYNC_WRAPPER_SUFFIX = `
})().then(() => { _ml.quit(); }, (e) => {
    printerr(e instanceof Error ? e.message : String(e));
    _exitCode = 1;
    _ml.quit();
});
_ml.run();
if (_exitCode !== 0) imports.system.exit(1);
`;

/**
 * Execute a shell command and resolve with its trimmed stdout.
 *
 * Rejects with an Error whose message is one of:
 *   "timeout"                    — process exceeded timeoutSeconds
 *   "Command exited with code N" — non-zero exit status
 *   "Failed to spawn: <msg>"     — could not fork/exec
 *
 * @param {string} command          - Shell command run via /bin/bash -c.
 * @param {number} timeoutSeconds   - Max wall-clock seconds before SIGKILL.
 * @returns {Promise<string>}       - Trimmed stdout.
 */
export function executeCommand(command, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS) {
    return _spawnProcess(['/bin/bash', '-c', command], timeoutSeconds);
}

/**
 * Execute JavaScript source code via a spawned GJS subprocess and resolve
 * with its trimmed stdout.  The code runs inside an async IIFE backed by a
 * GLib.MainLoop so await expressions work; use print() to emit the result.
 *
 * Rejects with the same error shapes as executeCommand.
 *
 * @param {string} code             - JavaScript source (body of async IIFE).
 * @param {number} timeoutSeconds   - Max wall-clock seconds before SIGKILL.
 * @returns {Promise<string>}       - Trimmed stdout.
 */
export function executeJavaScript(code, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS) {
    const gjsPath = GLib.find_program_in_path('gjs');
    if (!gjsPath) {
        return Promise.reject(new Error('gjs not found in PATH'));
    }
    const wrapped = JS_ASYNC_WRAPPER_PREFIX + code + JS_ASYNC_WRAPPER_SUFFIX;
    // Reuse executeCommand's implementation by delegating to an internal helper
    // that accepts an argv array instead of a shell string.
    // GJS >= 1.80 renamed --eval/-e to --command/-c.
    return _spawnProcess([gjsPath, '-c', wrapped], timeoutSeconds);
}

/**
 * Internal: spawn a process by explicit argv and resolve with trimmed stdout.
 * Shares timeout/kill logic with executeCommand.
 *
 * @param {string[]} argv
 * @param {number} timeoutSeconds
 * @returns {Promise<string>}
 */
function _spawnProcess(argv, timeoutSeconds) {
    return new Promise((resolve, reject) => {
        let timedOut = false;
        let timeoutSourceId = null;
        let proc;

        try {
            proc = new Gio.Subprocess({
                argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
        } catch (e) {
            reject(new Error(`Failed to spawn: ${e.message}`));
            return;
        }

        timeoutSourceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            timeoutSeconds * 1000,
            () => {
                timedOut = true;
                timeoutSourceId = null;
                try { proc.force_exit(); } catch (_) { /* already dead */ }
                return GLib.SOURCE_REMOVE;
            },
        );

        proc.communicate_utf8_async(null, null, (p, res) => {
            if (timeoutSourceId !== null) {
                GLib.source_remove(timeoutSourceId);
                timeoutSourceId = null;
            }

            try {
                const [, stdout] = p.communicate_utf8_finish(res);

                if (timedOut) {
                    reject(new Error('timeout'));
                    return;
                }

                const exitCode = p.get_exit_status();
                if (exitCode !== 0) {
                    reject(new Error(`Command exited with code ${exitCode}`));
                    return;
                }

                resolve((stdout ?? '').trim());
            } catch (e) {
                reject(e);
            }
        });
    });
}
