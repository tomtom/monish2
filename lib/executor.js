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
    return new Promise((resolve, reject) => {
        let timedOut = false;
        let timeoutSourceId = null;
        let proc;

        try {
            proc = new Gio.Subprocess({
                argv: ['/bin/bash', '-c', command],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
        } catch (e) {
            reject(new Error(`Failed to spawn: ${e.message}`));
            return;
        }

        // Kill the process if it runs too long
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
            // Cancel the kill-timer if the process finished on its own
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
