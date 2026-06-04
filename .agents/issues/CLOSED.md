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
