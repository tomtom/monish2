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
