/**
 * Pure-JS monitor data model and evaluation logic.
 * No GJS dependencies — safe to import in Node.js for unit testing.
 *
 * Assumptions: all functions are stateless; callers own the data lifecycle.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * All possible states a monitor's latest result can be in.
 * Ordered from least to most severe for comparisons.
 */
export const MonitorStatus = Object.freeze({
    PENDING: 'pending',   // no result yet
    NORMAL:  'normal',    // running, value within thresholds
    CAUTION: 'caution',   // value triggered a caution threshold
    DANGER:  'danger',    // value triggered a danger threshold
    ERROR:   'error',     // command failed or timed out
});

/**
 * Execution type for a monitor command.
 * SHELL  — command is executed via /bin/bash -c (default).
 * JAVASCRIPT — command is JavaScript source executed via GJS.
 */
export const MonitorType = Object.freeze({
    SHELL:      'shell',
    JAVASCRIPT: 'javascript',
});

/** Severity rank for each status — higher = worse. */
const STATUS_RANK = {
    [MonitorStatus.PENDING]: 0,
    [MonitorStatus.NORMAL]:  1,
    [MonitorStatus.CAUTION]: 2,
    [MonitorStatus.DANGER]:  3,
    [MonitorStatus.ERROR]:   4,
};

// ---------------------------------------------------------------------------
// Value extraction
// ---------------------------------------------------------------------------

/**
 * Apply an optional regex to raw command output to extract a display value.
 * Capture group 1 is preferred; falls back to full match; falls back to raw output.
 *
 * @param {string} output - Raw stdout from the monitor command.
 * @param {string|null|undefined} regex - Pattern to apply; falsy = no transform.
 * @returns {string} Extracted value string, trimmed.
 */
export function parseValue(output, regex) {
    if (!regex || regex.trim() === '') {
        return output.trim();
    }
    try {
        const re = new RegExp(regex);
        const match = re.exec(output);
        if (!match) return output.trim();
        return (match[1] !== undefined ? match[1] : match[0]).trim();
    } catch (_) {
        // Bad regex: return raw output so the user can still see something
        return output.trim();
    }
}

// ---------------------------------------------------------------------------
// Threshold pattern matching
// ---------------------------------------------------------------------------

/**
 * Parse a time string into total minutes.
 * Accepts "Xh Ym", "Xh", "Ym" (X and Y are non-negative integers).
 * Returns null when the string is not a recognised time format.
 *
 * @param {string} str
 * @returns {number|null}
 */
function parseTimeToMinutes(str) {
    const s = (str ?? '').trim();
    const full  = /^(\d+)h\s+(\d+)m$/.exec(s);
    if (full)  return parseInt(full[1]) * 60 + parseInt(full[2]);
    const hours = /^(\d+)h$/.exec(s);
    if (hours) return parseInt(hours[1]) * 60;
    const mins  = /^(\d+)m$/.exec(s);
    if (mins)  return parseInt(mins[1]);
    return null;
}

/**
 * Match a single extracted value against one threshold pattern string.
 *
 * Pattern syntax (tried in order):
 *   "N-M"      — numeric range [N, M] inclusive (e.g. "70-90")
 *   ">N" …     — numeric comparison: >, >=, <, <=, =
 *   "<Nh"/"<Nm"— time comparison: value parsed as "Xh Ym"/"Xh"/"Ym" vs threshold in
 *                hours (h) or minutes (m).  Supports >, >=, <, <=, = operators.
 *   else        — treated as a regex; falls back to exact-string if invalid regex
 *
 * @param {string} value   - The extracted monitor value string.
 * @param {string} pattern - A threshold pattern as described above.
 * @returns {boolean}
 */
export function matchesPattern(value, pattern) {
    if (!pattern || pattern.trim() === '') return false;
    const p = pattern.trim();

    // Numeric range: "N-M" or "N.f-M.f"
    const rangeMatch = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(p);
    if (rangeMatch) {
        const num = parseFloat(value);
        if (!isNaN(num)) {
            return num >= parseFloat(rangeMatch[1]) && num <= parseFloat(rangeMatch[2]);
        }
    }

    // Numeric comparison operators
    const cmpMatch = /^(>=?|<=?|=)(\d+(?:\.\d+)?)$/.exec(p);
    if (cmpMatch) {
        const num = parseFloat(value);
        const threshold = parseFloat(cmpMatch[2]);
        if (!isNaN(num)) {
            switch (cmpMatch[1]) {
            case '>':  return num > threshold;
            case '>=': return num >= threshold;
            case '<':  return num < threshold;
            case '<=': return num <= threshold;
            case '=':  return num === threshold;
            }
        }
    }

    // Time comparison operators: e.g. "<1h", "<=30m", ">2h"
    const timeMatch = /^(>=?|<=?|=)(\d+(?:\.\d+)?)(h|m)$/.exec(p);
    if (timeMatch) {
        const totalMinutes = parseTimeToMinutes(value);
        if (totalMinutes !== null) {
            const unit = timeMatch[3];
            const thresholdMinutes = unit === 'h'
                ? parseFloat(timeMatch[2]) * 60
                : parseFloat(timeMatch[2]);
            switch (timeMatch[1]) {
            case '>':  return totalMinutes > thresholdMinutes;
            case '>=': return totalMinutes >= thresholdMinutes;
            case '<':  return totalMinutes < thresholdMinutes;
            case '<=': return totalMinutes <= thresholdMinutes;
            case '=':  return totalMinutes === thresholdMinutes;
            }
        }
    }

    // Regex / string fallback
    try {
        return new RegExp(p).test(value);
    } catch (_) {
        return value === p;
    }
}

/**
 * Check whether a value matches any pattern in an array.
 *
 * @param {string} value
 * @param {string[]|null|undefined} patterns
 * @returns {boolean}
 */
export function matchesAnyPattern(value, patterns) {
    if (!patterns || patterns.length === 0) return false;
    return patterns.some(p => matchesPattern(value, p));
}

// ---------------------------------------------------------------------------
// Status evaluation
// ---------------------------------------------------------------------------

/**
 * Determine the status of a monitor based on its extracted value and thresholds.
 * DANGER is checked before CAUTION so the worse state always wins.
 *
 * @param {string}   value           - Extracted display value.
 * @param {string[]|null} cautionPatterns
 * @param {string[]|null} dangerPatterns
 * @returns {'normal'|'caution'|'danger'}
 */
export function evaluateStatus(value, cautionPatterns, dangerPatterns) {
    if (matchesAnyPattern(value, dangerPatterns))  return MonitorStatus.DANGER;
    if (matchesAnyPattern(value, cautionPatterns)) return MonitorStatus.CAUTION;
    return MonitorStatus.NORMAL;
}

/**
 * Format an Error from a monitor execution into a short display string.
 * Returns 'timeout' for timeout errors; otherwise returns the first line of
 * e.message, truncated to 80 characters with an ellipsis if needed.
 *
 * @param {Error} e
 * @returns {string}
 */
export function formatError(e) {
    if (e.message === 'timeout') return 'timeout';
    const firstLine = (e.message ?? '').split('\n')[0];
    if (!firstLine) return 'error';
    return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
}

/**
 * Return the worst (highest severity) status from an array of status strings.
 * Useful for computing the overall panel indicator state.
 *
 * @param {string[]} statuses
 * @returns {string} One of MonitorStatus values.
 */
export function worstStatus(statuses) {
    if (!statuses || statuses.length === 0) return MonitorStatus.NORMAL;
    return statuses.reduce((worst, s) =>
        (STATUS_RANK[s] ?? 0) > (STATUS_RANK[worst] ?? 0) ? s : worst,
    MonitorStatus.NORMAL);
}

/**
 * Count how many statuses are CAUTION or DANGER.
 *
 * @param {string[]} statuses - Array of MonitorStatus values.
 * @returns {number}
 */
export function countAlertStatuses(statuses) {
    if (!statuses || statuses.length === 0) return 0;
    return statuses.filter(
        s => s === MonitorStatus.CAUTION || s === MonitorStatus.DANGER,
    ).length;
}

// ---------------------------------------------------------------------------
// Interval helpers
// ---------------------------------------------------------------------------

/** Seconds-per-unit map used by intervalToMs. */
const UNIT_SECONDS = {seconds: 1, minutes: 60, hours: 3600};

/**
 * Convert a human-readable interval (value + unit) to milliseconds.
 *
 * @param {number} value - Numeric interval.
 * @param {'seconds'|'minutes'|'hours'} unit
 * @returns {number} Milliseconds.
 */
export function intervalToMs(value, unit) {
    return value * (UNIT_SECONDS[unit] ?? 1) * 1000;
}

/**
 * Apply a random ±jitter% offset to an interval in milliseconds.
 * When jitterPercent is 0 (or falsy), returns intervalMs unchanged.
 * The result is always at least 1000 ms.
 *
 * @param {number} intervalMs     - Base interval in milliseconds.
 * @param {number|null} jitterPercent - Jitter as a percentage (0–50).
 * @returns {number} Jittered interval in milliseconds.
 */
export function jitteredInterval(intervalMs, jitterPercent) {
    if (!jitterPercent || jitterPercent <= 0) return intervalMs;
    const fraction = jitterPercent / 100;
    const delta    = intervalMs * fraction * (Math.random() * 2 - 1);
    return Math.max(1000, Math.round(intervalMs + delta));
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Deserialize a JSON string (from GSettings) into an array of monitor objects.
 * Returns an empty array on any parse failure so callers always get an array.
 *
 * @param {string} json
 * @returns {object[]}
 */
export function deserializeMonitors(json) {
    if (!json) return [];
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

/**
 * Serialize a monitor array to a JSON string for GSettings storage.
 *
 * @param {object[]} monitors
 * @returns {string}
 */
export function serializeMonitors(monitors) {
    return JSON.stringify(monitors);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a monitor object.  Returns an array of human-readable error messages.
 * An empty array means the monitor is valid.
 *
 * @param {object} monitor
 * @returns {string[]}
 */
export function validateMonitor(monitor) {
    const errors = [];
    if (!monitor.name || monitor.name.trim() === '') {
        errors.push('Name is required');
    }
    if (!monitor.command || monitor.command.trim() === '') {
        errors.push('Command is required');
    }
    // 0 is valid: it means the monitor is disabled.
    if (monitor.intervalSeconds == null || monitor.intervalSeconds < 0) {
        errors.push('Interval must be 0 (disabled) or a positive number of seconds');
    }
    return errors;
}

// ---------------------------------------------------------------------------
// Interval display helpers
// ---------------------------------------------------------------------------

/**
 * Convert a (magnitude, unit) pair to total seconds.
 * Inverse of splitInterval.
 *
 * @param {number} value
 * @param {'seconds'|'minutes'|'hours'} unit
 * @returns {number}
 */
export function toSeconds(value, unit) {
    const multipliers = {seconds: 1, minutes: 60, hours: 3600};
    return value * (multipliers[unit] ?? 1);
}

/**
 * Split an interval in seconds into a human-friendly (magnitude, unit) pair.
 * Prefers larger units to avoid e.g. "3600 seconds".
 * Returns {magnitude: 1, unit: 'minutes'} for invalid or zero inputs so that
 * the UI never displays "0 minutes".
 *
 * @param {number} seconds
 * @returns {{magnitude: number, unit: string}}
 */
export function splitInterval(seconds) {
    // Clamp to positive integer; fall back to 60 (1 min) for invalid values.
    const s = (Number.isFinite(seconds) && seconds >= 1)
        ? Math.round(seconds)
        : 60;
    if (s % 3600 === 0 && s >= 3600) return {magnitude: s / 3600, unit: 'hours'};
    if (s % 60   === 0 && s >= 60)   return {magnitude: s / 60,   unit: 'minutes'};
    return {magnitude: s, unit: 'seconds'};
}

// ---------------------------------------------------------------------------
// Argument injection
// ---------------------------------------------------------------------------

/**
 * Inject monitor arguments into a command before execution.
 *
 * JavaScript monitors: prepends `const NAME = "value";` declarations so the
 *   values are available as top-level JS variables.
 * Shell monitors: prepends `export NAME='value';` so the values are available
 *   as environment variables (single-quote escaped to prevent injection).
 *
 * @param {string}   command   - Raw command / script body.
 * @param {string}   type      - MonitorType value (JAVASCRIPT or SHELL).
 * @param {object[]|null} args - Arg definitions: [{name, label, default?}].
 * @param {object|null} argValues - Current arg values: {name: value}.
 * @returns {string} Command with injected arg bindings prepended.
 */
export function injectArgs(command, type, args, argValues) {
    if (!args || args.length === 0) return command;
    const defs = args.filter(a => a.name && a.name.trim());
    if (defs.length === 0) return command;

    if (type === MonitorType.JAVASCRIPT) {
        const prefix = defs.map(a => {
            const value = String(argValues?.[a.name] ?? '');
            return `const ${a.name} = ${JSON.stringify(value)};`;
        }).join('\n') + '\n';
        return prefix + command;
    }

    // Shell: single-quote escaping prevents injection
    const prefix = defs.map(a => {
        const value   = String(argValues?.[a.name] ?? '');
        // Shell escape: ' → '\'' (end quote, literal quote, reopen quote)
        const escaped = value.replace(/'/g, '\'\\\'\'');
        return `export ${a.name}='${escaped}';`;
    }).join('\n') + '\n';
    return prefix + command;
}

// ---------------------------------------------------------------------------
// Sparkline helpers
// ---------------------------------------------------------------------------

/**
 * Unicode block elements from lightest (▁) to fullest (█), used for sparklines.
 * Index 0 is the smallest bar; index 7 is the tallest.
 */
export const SPARKLINE_CHARS = '▁▂▃▄▅▆▇█';

/** Maximum number of numeric values remembered per monitor for the sparkline. */
export const SPARKLINE_MAX_VALUES = 20;

/**
 * Extract the first numeric value (integer or decimal, optionally signed) from
 * a string.  Returns NaN when the string contains no number.
 *
 * Used to convert arbitrary monitor output strings into a value for the ring buffer.
 *
 * @param {string} str
 * @returns {number}
 */
export function extractNumber(str) {
    const m = /[-+]?\d+(?:\.\d+)?/.exec(str ?? '');
    return m ? parseFloat(m[0]) : NaN;
}

/**
 * Build a sparkline string from an array of numeric values.
 * The bar heights are relative to the min/max of the supplied array.
 * When all values are equal (zero range), a row of mid-height bars is returned.
 *
 * @param {number[]} values - Non-empty array of finite numbers.
 * @returns {string} Sparkline composed of SPARKLINE_CHARS characters.
 */
export function buildSparkline(values) {
    if (!values || values.length === 0) return '';
    const min   = Math.min(...values);
    const max   = Math.max(...values);
    const range = max - min;
    return values.map(v => {
        const level = range === 0 ? (min === 0 ? 0 : 3) : Math.round((v - min) / range * 7);
        return SPARKLINE_CHARS[Math.min(7, Math.max(0, level))];
    }).join('');
}

/**
 * Like buildSparkline but returns a Pango markup string, colouring bars whose
 * stored numeric value triggers CAUTION (#e5a50a) or DANGER (#e01b24).
 * When neither pattern set is provided the output is identical to buildSparkline.
 *
 * @param {number[]}        values          - Non-empty array of finite numbers.
 * @param {string[]|null}   cautionPatterns
 * @param {string[]|null}   dangerPatterns
 * @returns {string} Pango markup string.
 */
export function buildSparklineMarkup(values, cautionPatterns, dangerPatterns) {
    if (!values || values.length === 0) return '';
    const hasPatterns = (cautionPatterns?.length ?? 0) + (dangerPatterns?.length ?? 0) > 0;
    const min   = Math.min(...values);
    const max   = Math.max(...values);
    const range = max - min;
    return values.map(v => {
        const level = range === 0 ? (min === 0 ? 0 : 3) : Math.round((v - min) / range * 7);
        const bar = SPARKLINE_CHARS[Math.min(7, Math.max(0, level))];
        if (!hasPatterns) return bar;
        const status = evaluateStatus(String(v), cautionPatterns, dangerPatterns);
        if (status === MonitorStatus.DANGER)  return `<span color="#e01b24">${bar}</span>`;
        if (status === MonitorStatus.CAUTION) return `<span color="#e5a50a">${bar}</span>`;
        return bar;
    }).join('');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Generate a collision-resistant ID for a new monitor.
 * Not cryptographically secure; just needs to be unique within a settings file.
 *
 * @returns {string}
 */
export function generateId() {
    return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a monitor object with sane defaults, optionally overridden.
 * Callers must supply at least name and command before saving.
 *
 * @param {Partial<object>} overrides - Fields to override.
 * @returns {object} Full monitor object.
 */
export function createMonitor(overrides = {}) {
    const monitor = {
        id:                    generateId(),
        name:                  '',
        description:           '',
        helpText:              '',
        command:               '',
        type:                  MonitorType.SHELL,
        intervalSeconds:       60,
        outputRegex:           '',
        cautionPatterns:       [],
        dangerPatterns:        [],
        enabled:               true,
        onDemand:              false,
        onDemandValidSeconds:  60,
        args:                  [],
        argValues:             {},
        actions:               [],
        showSparkline:         true,
        ...overrides,
    };
    // Populate argValues from arg `default` fields when not already set.
    // This allows preset definitions to ship sensible defaults.
    for (const arg of (monitor.args ?? [])) {
        if (arg.name && monitor.argValues[arg.name] === undefined && arg.default !== undefined) {
            monitor.argValues[arg.name] = arg.default;
        }
    }
    return monitor;
}
