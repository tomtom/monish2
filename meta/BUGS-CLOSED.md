1. Error in Extension Manager: Extension is incompatible with the current version of GNOME (which is 50) #closed/2026-05-30
2. Error in Prefs: ImportError: Unable to load file from: resource:///org/gnome/shell/extensions/prefs.js (The resource at "/org/gnome/shell/extensions/prefs.js" does not exist) #closed/2026-05-30
3. In Prefs: Extension hangs when adding predefined monitors, e.g., CPU Usage. The monitor is being added though. #closed/2026-05-30
4. In Prefs: For each predefined monitor, add a description of what it does. #closed/2026-05-30
5. In Prefs: Could the extension directly execute javascript code when a monitor is defined as javascript? If so, prefer async javascript over python for predefined monitors. #closed/2026-05-30
7. In Prefs: When a predefined monitor was added, hide it from the list of predefined monitors. #closed/2026-05-30
8. In Prefs: For each (added) monitor, add a duplicate action. #closed/2026-05-30
9. In Prefs: Predefined monitors should not run more frequent than every 60s. #closed/2026-05-30
10. E.g., the CPU Temperature monitor is marked as CAUTION (yellow) but the icon in the GNOME top bar is unchanged. It should also be shown in yellow with an exclamation mark icon (as overlay or be replaced by it). #closed/2026-05-30
6. In Prefs: Frequent "Extension not responding" warnings with the option to force quit the extension. #closed/2026-05-30
11. Error with the CPU Usage, Net Download, and Net Upload presets. If an error occurs, an informative message should be displayed either in the menu or in prefs. #closed/2026-05-30
12. The display of the 3 top processes isn't useful this way. Would it be possible to display the processes with a line-break and to display just the app name, not the full file name? #closed/2026-05-30
13. Change the icon: just display 5 vertical bars with varying height, some darker, some lighter. #closed/2026-05-30
14. Loading the gnome shell takes a long time. Don't test the monitor values right at startup but only after some grace period. #closed/2026-05-30
15. In Prefs: When adding a predefined monitor the time is set to 0 minutes. It should be at least 60 secs. #closed/2026-05-30
16. In Prefs: When I duplicate a monitor and then delete the duplicate, both monitors are deleted. Also: the duplicated monitor should have a " Copy" suffix. #closed/2026-05-30
17. In Prefs: Add a way to manually sort the list of defined monitors. #closed/2026-05-30
18. In Prefs: The CPU Frequency monitor calls awk etc. Could this be implemented in JavaScript, too? #closed/2026-05-30
19. In Prefs: All predefined monitors are shell commands. Weren't they implemented as JavaScript? (I previously added and removed all predefined monitors.) #closed/2026-05-30
20. Add on-demand monitors: instead of the value, display a "Update" button. When the user clicks the button, the button text is replaced with the value. The user can define how long the value is valid. When the time period is over, show "Update" again. #closed/2026-05-30
21. Support monitors with multi-line output - the output is displayed below the monitor name. #closed/2026-05-30
22. Change the default value for Schedule to 1 minute. When planning to run the command, convert the timeing to seconds and add +/-5% random time units. Add a jitter (default: 5%) option to prefs. When the jitter is 0, run exactly on time. #closed/2026-05-30
23. In Prefs: When I add a predefined monitor, the interval is shown as 0 minutes. The min value should be 1s. The default value for predefined monitors must be 1m. #closed/2026-05-31
24. In Prefs: the default for jitter should be 5%. #closed/2026-05-31
25. All predefined monitors show an error: Command exited with code 1. #closed/2026-05-31
26. In Prefs: When I open Prefs (and the list is empty?) at first, the "Add Monitor" button is shown at the bottom. When I add a predefined monitor, the Add button is shown at the top. When I remove the predefined monitor the Add button is shown at the top. Make sure the Add button is always shown at the top. #closed/2026-05-31
27. In Prefs: The execution intervalls are given in minutes. They should be defined in seconds. #closed/2026-05-31
28. In Prefs: The execution intervalls for predefined monitors is set to 0 minutes. The default value should be 60s. The value is not persisted and is reset to 0 evertime the monitor is edited. #closed/2026-05-31
29. In Prefs: The default value for the jitter preset should be 5%. It is (always reset to) 0 when (re-) opening the Prefs dialog. The value is not persisted. #closed/2026-05-31
29b. In Prefs (re-open): interval SpinButton shows 0 for monitors with old stored data (intervalSeconds:0); edited interval is reset to 0 on re-open. Root cause: GJS GObject property init ordering leaves Gtk.Adjustment unclamped when value is set before lower. #closed/2026-05-31
30. In Prefs: Add a debug option that logs command execution: timestamp, monitor name, execution type, result. The log can be viewed in extra window. #closed/2026-05-31
31. intervalSeconds=0 means monitor is deactivated; edit dialog shows note; disabled monitors greyed out in prefs list; extension skips interval=0 monitors. #closed/2026-05-31
32. Thermal Zone 1 fails (thermal_zone1 absent on many machines) and Top MEM/CPU Processes fail intermittently (proc entry vanishes mid-scan) — GLib.file_get_contents throws in GJS, fixed with try/catch. #closed/2026-05-31
33. Battery Level preset shows N/A — outer try/catch swallowed the throw from AC's missing capacity file before BAT0 was reached; fixed with per-entry inner try/catch. #closed/2026-05-31
34. Update the monitor when the user clicks on the name — name label changed to St.Button; clicking triggers _triggerMonitor which cancels the scheduled timer, runs immediately, then reschedules. Update button removed; on-demand monitors now triggered by name-click. #closed/2026-05-31
35. Remember latest 20 values and display a sparkline — extractNumber/buildSparkline added to lib/monitor.js; extension keeps per-monitor ring buffer (max 20); sparkline appended inline after the value using Unicode block chars ▁▂▃▄▅▆▇█; error values excluded from history. #closed/2026-05-31
36. Monitor user-defined arguments — injectArgs() in lib/monitor.js prepends const NAME=value for JS monitors and export NAME=value for shell monitors; prefs edit dialog has Arguments section with Add/delete UI and type-aware tooltips; createMonitor populates argValues from arg defaults. #closed/2026-05-31
37. Top CPU/MEM Processes: EXCLUDE arg (default: gjs) added to both presets; scripts check _exclude regexp against comm before including a process. #closed/2026-05-31
38. Top MEM Processes displayed % of total RAM instead of actual usage; replaced with _fmtMem() outputting MB/GB. #closed/2026-05-31
39. Multiline monitor status icon was vertically centered; set y_align: Clutter.ActorAlign.START so it aligns with the name label. #closed/2026-05-31
40. Debug log changed from pipe-separated to tab-separated (TSV) format. #closed/2026-05-31
41. Added Logged-in Users preset — GJS script calls who via GLib.spawn_command_line_sync, deduplicates with Set, prints comma-separated sorted names. #closed/2026-05-31
42. Add predefined monitor for Thermal Zone 0 in the Thermal section of PRESET_MONITORS. #closed/2026-05-31
43. Hover tooltip on monitor value: shows monitor description when hovering over value labels. #closed/2026-05-31
44. Prefs up/down: store _monitorId on rows and grab_focus() after rebuild to keep moved item visible. #closed/2026-05-31
45. interval=0s = on-demand: removed On Demand toggle; derive onDemand from intervalSeconds===0; subtitle 'on-demand'; opacity only for !enabled. #closed/2026-05-31
46. Top CPU/MEM per-app sparklines: _appHistory tracks last 20 values per app; sparkline appended per line of multi-line output. #closed/2026-05-31
47. Right-align all sparklines: sparklines are right-aligned in their display context. #closed/2026-05-31
48. Top CPU Processes EXCLUDE default changed from 'gjs' to '^(gjs)$' for exact name matching. #closed/2026-05-31
49. Logged-in Users: multiline output 'NAME: seat0, tty2' — groups login methods per user via who. #closed/2026-05-31
50. Monitor action commands: Actions section in edit dialog; status icon toggles actionsBox with per-action buttons; _runAction executes and refreshes value. #closed/2026-05-31
51. Gnome RDP preset: grdctl status via GJS, CAUTION when enabled, Enable/Disable action commands. #closed/2026-05-31
52. In Prefs: Cannot edit "Gnome RDP" monitor — cmdPreview now normalises whitespace so Adw.ActionRow subtitle is single-line, keeping suffix buttons in correct click position. #closed/2026-06-01
53. Per-app sparklines in Top CPU/MEM Processes right-aligned — mlBox with per-line HBox rows (lineText x_expand + lineSpark) replaces inline text embedding. #closed/2026-06-01
54. Per-monitor sparkline toggle: showSparkline boolean in model (default true), Switch in edit dialog, extension skips sparkline when false. #closed/2026-06-02
55. Logged-in Users preset: showSparkline set to false — multi-line user list has no meaningful sparkline. #closed/2026-06-02
56. Gnome RDP Status N/A: grdctl status --headless is invalid; changed to grdctl status. #closed/2026-06-02
58. Monitors with actions use ACTION_STATUS_ICONS (view-more-symbolic ⋮ for PENDING/NORMAL) to signal the status icon is clickable for actions. #closed/2026-06-02
59. Up/down in Prefs no longer jumps scroll: findScrolledWindow saves vadjustment before rebuild; GLib.idle_add restores it after grab_focus. #closed/2026-06-02
60. Last Login preset: last -n 1 -w, extracts user/tty/date via regex, showSparkline:false. #closed/2026-06-02
61. Top CPU/MEM Processes: added COUNT arg (default '3'); scripts use _count variable in slice(0, _count). #closed/2026-06-02
62. CPU Power (RAPL) preset: reads energy_uj twice over 0.5s, computes watts; description includes chmod/udev help text. #closed/2026-06-02
63. Battery Time Remaining preset: reads energy_now/power_now or charge_now/current_now; shows AC on mains; showSparkline:false. #closed/2026-06-02
64. Action button guard: optional JS guard expression on each action; evaluated with current value in _setMonitorResult; Gnome RDP preset uses guards for Enable/Disable. #closed/2026-06-02
65. Export/import monitors as JSON: showExportDialog (Gtk.FileDialog.save + pretty JSON) and showImportDialog (open + append/replace dialog). #closed/2026-06-02
66. Description field in monitor edit dialog; preset descriptions pre-filled; shown in monitor list subtitle. #closed/2026-06-02
67. Monitors with actions show real status icon + ⋮ toggle alongside (not instead of status icon). #closed/2026-06-02
68. CPU Power (RAPL): helpText field with chmod/udev setup instructions; clickable Setup link in edit dialog. #closed/2026-06-02
69. Tooltip in monitor menu now positioned above cursor using get_preferred_height, not below. #closed/2026-06-02
70. When multiple monitors are in CAUTION/DANGER, show one '!' per alerting monitor in the toolbar badge. #closed/2026-06-02
71. In Gnome RDP Preset: When enabled, count the entries from `ss -tnp | grep ':3389'` (if the command exists; check once on startup) and put the number into parentheses next to enabled. When the number is > 0 then mark the monitor as DANGER. #closed/2026-06-02
72. Add a predefined (JavaScript) monitor "RAM Free" that corresponds to the "free" value in `free -h`. #closed/2026-06-02
73. The sparklines get zapped when the screen locks and similar events. Make sure the sparklines and the latest monitor values persist of screen locks etc. #closed/2026-06-02
74. In toolbar menu: For monitors with actions, use an overlay (dot or similar) to indicate interactivity. Don't use the three dots icon. #closed/2026-06-02
