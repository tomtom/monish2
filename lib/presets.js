/**
 * Pre-defined monitor configurations for common system metrics.
 *
 * All commands use only tools guaranteed to be present on Fedora, Debian,
 * Ubuntu, and Arch Linux (/proc filesystem, python3, free, ps, ip).
 * Commands that require a 1-second sample use python3 one-liners to keep
 * external dependencies minimal.
 *
 * Each preset is a partial monitor object suitable for spreading into
 * createMonitor() — it has everything except `id` (assigned on add).
 */

// ---------------------------------------------------------------------------
// Helpers embedded in preset commands
// ---------------------------------------------------------------------------

/**
 * Python3 one-liner that samples /proc/stat over 0.5 s and prints CPU %.
 * Available on all major distros without extra packages.
 */
const CPU_USAGE_CMD = [
    'python3 -c "',
    'import time;',
    'f=open(\'/proc/stat\');s1=list(map(int,f.readline().split()[1:]));f.close();',
    'time.sleep(0.5);',
    'f=open(\'/proc/stat\');s2=list(map(int,f.readline().split()[1:]));f.close();',
    'd=[s2[i]-s1[i] for i in range(len(s1))];t=sum(d);',
    'print(f\'{(t-d[3])*100/t:.0f}\')',
    '"',
].join('');

/**
 * Python3 one-liner that measures per-interface RX/TX bytes over 1 s
 * using the default route interface.
 * $1 = direction: 'rx' (index 1) or 'tx' (index 9) in /proc/net/dev split.
 */
function netRateCmd(direction) {
    const idx = direction === 'rx' ? 1 : 9;
    return [
        'python3 -c "',
        'import time,subprocess;',
        'r=subprocess.run([\'ip\',\'r\',\'show\',\'default\'],capture_output=1,text=1);',
        'parts=r.stdout.split();',
        'iface=parts[4] if len(parts)>4 else \'eth0\';',
        'def b():',
        '  with open(\'/proc/net/dev\') as f:',
        '    for l in f:',
        `      if iface+\':\' in l: return int(l.split()[${idx}])`,
        '  return 0;',
        'b1=b();time.sleep(1);b2=b();d=b2-b1;',
        'print(f\'{d/1024:.1f}KB/s\' if d<1048576 else f\'{d/1048576:.2f}MB/s\')',
        '"',
    ].join('');
}

// ---------------------------------------------------------------------------
// Preset list
// ---------------------------------------------------------------------------

/**
 * All available preset monitors, ordered by category.
 * Each object is a valid argument for createMonitor().
 */
export const PRESET_MONITORS = [
    // ---- CPU ---------------------------------------------------------------
    {
        name:            'CPU Usage',
        command:         CPU_USAGE_CMD,
        intervalSeconds: 5,
        outputRegex:     '',
        cautionPatterns: ['>70'],
        dangerPatterns:  ['>90'],
        enabled:         true,
    },
    {
        name:            'CPU Frequency',
        // scaling_cur_freq is in kHz; convert to MHz
        command:         'awk \'{printf "%.0f MHz", $1/1000}\' /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo "N/A"',
        intervalSeconds: 10,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
    {
        name:            'CPU Temperature',
        // thermal_zone0 is most commonly the CPU thermal zone
        command:         'awk \'{printf "%.1f", $1/1000}\' /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "N/A"',
        intervalSeconds: 10,
        outputRegex:     '',
        cautionPatterns: ['>70'],
        dangerPatterns:  ['>90'],
        enabled:         true,
    },

    // ---- RAM ---------------------------------------------------------------
    {
        name:            'RAM Used',
        command:         'free -h | awk \'/^Mem/{print $3 "/" $2}\'',
        intervalSeconds: 10,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
    {
        name:            'RAM Free',
        command:         'free -h | awk \'/^Mem/{print $4}\'',
        intervalSeconds: 10,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },

    // ---- Swap --------------------------------------------------------------
    {
        name:            'Swap Usage',
        command:         'free -h | awk \'/^Swap/{if($2=="0B" || $2=="0")print "No swap"; else print $3 "/" $2}\'',
        intervalSeconds: 30,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },

    // ---- Network -----------------------------------------------------------
    {
        name:            'Net Download',
        command:         netRateCmd('rx'),
        intervalSeconds: 5,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
    {
        name:            'Net Upload',
        command:         netRateCmd('tx'),
        intervalSeconds: 5,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },

    // ---- Thermal -----------------------------------------------------------
    {
        name:            'Thermal Zone 1',
        command:         'awk \'{printf "%.1f", $1/1000}\' /sys/class/thermal/thermal_zone1/temp 2>/dev/null || echo "N/A"',
        intervalSeconds: 15,
        outputRegex:     '',
        cautionPatterns: ['>70'],
        dangerPatterns:  ['>90'],
        enabled:         true,
    },

    // ---- Battery -----------------------------------------------------------
    {
        name:            'Battery Level',
        // Searches all power_supply entries for the first battery capacity
        command:         'find /sys/class/power_supply -name capacity 2>/dev/null | head -1 | xargs cat 2>/dev/null | awk \'{print $1"%"}\' || echo "N/A"',
        intervalSeconds: 60,
        outputRegex:     '(\\d+)',
        cautionPatterns: ['<30'],
        dangerPatterns:  ['<10'],
        enabled:         true,
    },

    // ---- Processes ---------------------------------------------------------
    {
        name:            'Top CPU Processes',
        command:         'ps aux --sort=-%cpu 2>/dev/null | awk \'NR>=2 && NR<=4 {printf "%s %.0f%%  ", substr($11,1,10), $3}\'',
        intervalSeconds: 10,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
    {
        name:            'Top MEM Processes',
        command:         'ps aux --sort=-%mem 2>/dev/null | awk \'NR>=2 && NR<=4 {printf "%s %.0f%%  ", substr($11,1,10), $4}\'',
        intervalSeconds: 10,
        outputRegex:     '',
        cautionPatterns: [],
        dangerPatterns:  [],
        enabled:         true,
    },
];
