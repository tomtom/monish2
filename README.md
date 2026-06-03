# monish — GNOME Shell System Monitor Extension

A GNOME Shell extension that puts user-configurable system monitors directly
into the top panel. Originally developed for and tested on Fedora 44.

## What it does

Monish adds a status icon to the GNOME panel. Clicking it opens a menu with
live monitor values — CPU, RAM, network, disk, sensors, battery, or anything
you can script.

## Key features

- **Custom monitors** — define monitors with a name, command (shell script or
  JavaScript), interval, and a regex to extract the output value.
- **Predefined monitors** — 18 built-in presets for common system metrics.
  External presets can be added by dropping JSON files into
  `/usr/share/monish` or `~/.local/share/monish`.
- **Status coloring** — values matching warning/danger patterns are displayed
  in yellow or red. The panel icon reflects the worst status across all
  monitors.
- **Sparklines** — each monitor shows a mini inline history of recent values.
- **Multi-line output** — monitors producing multiple lines (e.g. top-N
  processes) are displayed in a compact list.
- **Actions** — monitors can offer one-click actions (e.g. enable/disable a
  service directly from the panel).
- **On-demand monitors** — mark monitors to run only when clicked, not on a
  timer.
- **Import/Export** — share monitor configurations via JSON files. Exports
  include a version number for forward compatibility.
- **Reordering & Duplication** — drag monitors up/down, duplicate them for
  quick variations.
- **Localisation** — translatable via gettext (`monish2@thm.link`).

![Example screenshot](Screenshot.png")


## Compatibility

GNOME Shell 45 – 50.

## Installation

Copy the extension directory to
`~/.local/share/gnome-shell/extensions/monish2@thm.link` and restart GNOME
Shell (Alt+F2, type `r`, Enter).

## License

GPL-3.0
