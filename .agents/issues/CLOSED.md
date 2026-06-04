132. 30s timer scheduling redesign — premise was false; no platform-level 30s tick exists in GNOME Shell. #closed/2026-06-04 #SHELVED
131. In the monitor-value list/menu: Prefix "Settings" with an appropriate icon. Make the settings menu item be horizontally aligned with the monitors. Use the same font/color for Settings as for monitor names. #closed/2026-06-04
130. For on-demand monitors, change the handling of stale values. Replace the indicator icon with the current stale badge "↻". #closed/2026-06-04
129. Warning in make shexli: EGO-M-005 session-modes should be omitted when only containing "user". #closed/2026-06-04
127. In Prefs / Edit Monitor with Actions: Explain how the guard expressions work (provide a simple help page). Are there any other operators than "matches"? #closed/2026-06-04
126. In Claude Usage: The patterns for CAUTION/DANGER don't work. "(5h):  14% (reset: Thu 04 16:00)" is marked as CAUTION although the value is just 14%, much below the CAUTION threshold. #closed/2026-06-04
80. In Prefs: Define two directories (/usr/share/monish and ~/.local/share/monish), from where monish reads json predefined monitor definitions (in addition to those provided by the extension itself). These definitions should have the same format as the export file. Add a version number to the export file format. #closed/2026-06-03
81. In the monitors menu/list: Drop the overlays as status indicators. Just use the indicator icon's color to indicate the status. #closed/2026-06-03
82. For predefined monitors from external json files: Add a CAUTION badge (as unicode character) to the name. On mouse over, show the filename that is the source for the predefined monitor. Don't hide external predefinitions with the same name as an internal predefined monitor. Show all predefined monitors. #closed/2026-06-03
83. Create a README.md file that explains the purpose of this gnome extension and the functionality that is relevant to endusers. State that it was originally developed for and tested on Fedora 44. #closed/2026-06-03
84. Add a make shexli target that create the zip and then runs `shexli monish2@thm.link.shell-extension.zip`.  Run that make target and fix all problems. #closed/2026-06-03
85. In the Battery Time Remaining preset: By default: CAUTION if less than 1h, DANGER if less than 30m. #closed/2026-06-03
86. Investigate tmp/claude-usage-api.gjs and add a predefined monitor that retrieves claude usage limits - display 5h and 7d limits in two lines. Set the default loop interval to 30m. By default: CAUTION after 75% and DANGER after 90%. #closed/2026-06-03
87. Investigate tmp/openrouter-usage.gjs and add a predefined monitor that retrieves openrouter (1) balance and (2) activity. Set the default loop interval to 15m. By default: CAUTION if Balance is smaller than 10$ and DANGER if smaller than 5$. #closed/2026-06-03
88. In Claude Usage and OpenRouter presets: make them on-demand (no automatic interval) by default. #closed/2026-06-03
89. For monitors that are set to on-demand, display the values age or the time stamp when the data was last collected (make this a user choice in Prefs). #closed/2026-06-03
90. After login, it takes a very long time until the desktop shows up. Investigate what in the extension could cause this. If you cannot find out the reason, develop a debugging strategy to solve this issue. #closed/2026-06-03
91. When a monitor is marked as CAUTION or DANGER, is this still shown in the top bar icon? The icon should be yellow or red (depending on the state) and exclamation marks should be shown for the number of monitors with a special state. #closed/2026-06-03
92. Tooltips (mouse over value) are still displayed below the menu. If you cannot fix this, remove the tooltips. #closed/2026-06-03
93. In Monitors: Intervall can be a javascript expressions that returns he planned intervall (pre-jitter). The intervall expression has to the arguments. #closed/2026-06-03
94. In Claude Usage: If claude is a running process, set the intervall to 15m, set to 0 otherwise. Add a AI Agent argument (a comma-separated list of accepted AI agents with default: `^(claude)$`). Only the basenames are used for matching -- as for the Top CPU processes. #closed/2026-06-03
95. In OpenRouter Usage: If opencode is a running process, set the intervall to 15m, set to 0 otherwise. Add a AI Agent argument (a comma-separated list of accepted AI agents with default: `^(opencode)$`). Only the basenames are used for matching -- as for the Top CPU processes. #closed/2026-06-03
96. In Monitors list: on-demand monitors are immediatly removed when sparkline's valid argument is 0 - even when sparklines are disabled. Disable sparklines for on-demand values. Remove the "valid for (s)" field. Never remove the on-demand value. Keep it until the next update. #closed/2026-06-03
97. Review https://gjs.guide/extensions/review-guidelines/review-guidelines.html and https://gjs.guide/extensions/ and summarize the most important points in docs/GnomeExtensionGuidelines.md. Check whether the monish extension adheres to these guidelines. #closed/2026-06-03
98. The values of on-demand monitors are seemingly not persisted across lock/unlock events - at least they are not displayed in the monitor-value list. Persist these values like the other monitor values. #closed/2026-06-03
99. The Gnome RDP monitor cannot be edited. #closed/2026-06-03
101. Ad `new Function()` in the Shell process (`extension.js`): implement a simple safe expression parser for the common cases, i.e., select a monitor (default: self) and check whether the value matches a regexp. Change the Gnome RDP preset accordingly. #closed/2026-06-03
102. Ad **3. Conditional `log()` in the Shell process**: Strip debug logging code from the zip. Ad **4. Debug log written to extension install directory**: irrelevant once stripped. #closed/2026-06-03
103. Ad **7. `gettext-domain` set but unused**: Add placeholder `po/` directory; add localizations for all important European languages; change code to pick up language setting. #closed/2026-06-03
104. Add `"session-modes": ["user"]` to metadata.json. #closed/2026-06-03
105. Add `extension.js` and `prefs.js` to the lint script. Note: current config sets `"env": {"node": true}`; GJS gi:// imports need a GNOME ESLint plugin or `globals` overrides to avoid false positives. #closed/2026-06-03
106. In Claude Usage preset: Also display when the quota resets. Format like `5h (reset: ...)      90%`. #closed/2026-06-04
107. In OpenRouter preset: In Activity, just display the $ amount. #closed/2026-06-04
108. In Prefs: Remove the "Interval (s)" field; use JS interval expression as sole interval input. Adjust help string and presets accordingly. #closed/2026-06-04
109. Startup still slow with Claude Usage and OpenRouter enabled. Add plain-number fast path in _resolveInterval to avoid subprocess spawning for trivial "60"-style expressions. #closed/2026-06-04
110. Issue 89 wasn't solved. With on-demand monitors, the value's age should be shown in the monitors list/menu. It is not. #closed/2026-06-04
111. In Prefs: When a monitor is edited and the changes are saved, the list is reset and the edited monitor could be out of view. Make sure the edited monitor is visible after saving the changes. #closed/2026-06-04
112. Remove the IntervalExpr (field and functionality) and replace it with the previously used "Interval (s)" field. The Claude and OpenRouter presets default to 0. #closed/2026-06-04
114. Editing the Gnome RDP preset still fails. It is the only monitor with actions and action guards. Make sure any error on Edit Monitor is displayed somewhere - in Prefs (best just below the monitor entry) #closed/2026-06-04
113. For on-demand monitors (i.e., Interval == 0) always underline the monitor name. #closed/2026-06-04
116. In Claude Usage preset: Change the value's format to "50% (reset: DATETIME)". #closed/2026-06-04
117. In OpenRouter preset: Show just the $ amount as the Activity value's, remove the "(30d): " prefix. #closed/2026-06-04
118. WRT to the edit Gnome RDP issue (see git log): Error No property monospace on GtkEntry. #closed/2026-06-04
119. In the Claude usage preset: for the reset also include the date ... or simply include the whole info as provided, e.g., "resets Thu 04 Jun 11:00". #closed/2026-06-04
115. Issue 110 (and related) still isn't fixed. The monitor value's age still isn't shown in the monitor list/menu. If the monitor value's age is > 15m, then add a Questionable badge (as unicode character) to the monitor name. #closed/2026-06-04
120. In Claude Usage and OpenRouter presets: Remove the obsolete "AI Agent regexp" argument. #closed/2026-06-04
121. In Monitor edit: clicking on "Setup instructions" does nothing. #closed/2026-06-04
122. In Claude Usage: Change the format for the reset date to "%a %d %H:%M". Or even better: make it a monitor argument and use that argument for formatting. #closed/2026-06-04
123. In Prefs: Add a reset-to-preset button for monitors whose command diverged from their preset definition. #closed/2026-06-04
124. For on-demand monitors: render stale badge as a separate label so the name underline does not extend to it; replace ❓ with ⏰. #closed/2026-06-04
125. Remove intervalExpression field from monitor schema and all related code; AI_AGENT_INTERVAL_JS was already absent. #closed/2026-06-04
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
75. In CPU Power (RAPL): Clicking on "Setup instructions" does nothing. #closed/2026-06-02
76. In Top CPU/MEM Processes: Display the numbers right-aligned (left of the sparkline; the same as with the other monitors) #closed/2026-06-02
77. The solution for issue #71 does not work. Undo that change. Remove the respective code. #closed/2026-06-02
78. Ad ISSUE 74: Make the overlay bigger and more succinct. May draw a box around the indicator icon. #closed/2026-06-02
79. Ad issue 78: Make the overlay the same color as the indicator icon - or the text. #closed/2026-06-02
80. In Prefs: Define two directories (/usr/share/monish and ~/.local/share/monish), from where monish reads json predefined monitor definitions (in addition to those provided by the extension itself). These definitions should have the same format as the export file. Add a version number to the export file format. #closed/2026-06-03
