Next number: 138


# Bugs & Feature Request

## Current

133. In Prefs: Do we still need the "On-demand time display" option or could it be removed?
134. In Prefs: Remove the debug log file, when debug logging is turned off.
135. In Prefs: The text below "Debug Logging" says "journalctl -b | grep [monish2]". This is wrong, because "[monish2]" prints all lines matching at least one of these characters. I assume you meant "journalctl -b | grep monish2". That said the logging of startup timing is useless in its present form since the log contains just a single entry.
136. In Prefs: Replace "Schedule Settings" with "Options".
137. Debug logging: Don't use a log file but log to the system's journal (as it is done for "startup timing". Remove the code that removes the logging from the production version in the ZIP file.


## Open

128. Issue 126 wasn't fixed: A values like "Rolling: 69% (reset: Thu 04 Jun 16:00)" and "Weekly: 81% (reset: Mon 08 Jun 11:00)" are marked as CAUTION but the respective thresholds are 75 and 90.
57. In Prefs: For each monitor, let users choose an icon (e.g., cpu, network, disk, memory, sensor, heat, light, keyboard, user, monitor, desktop, remote, gaming etc.). For icons, use unicode-characters (preferred) or icons provided by the theme or already installed on the system.
100. Add `COPYING` with GPL-3.0 text; update `Makefile` zip target to include it.




vim: set ft=markdown.pandoc tw=0 ts=4 :
