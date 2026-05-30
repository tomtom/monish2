# Makefile for the Monish GNOME Shell extension.
#
# Targets:
#   compile-schemas  Compile GSettings XML into a binary schema cache.
#   install          Install the extension to the user's GNOME extension dir.
#   uninstall        Remove the installed extension.
#   test             Run Jest unit tests (pure JS logic).
#   lint             Run ESLint on lib/ and test/.
#   audit            Check npm dependencies for known vulnerabilities.
#   test-all         Run lint, audit, and test in sequence.
#   clean            Remove generated artefacts.

UUID        := monish2@thm.link
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMA_DIR  := schemas

.PHONY: all compile-schemas install uninstall test lint audit test-all clean

all: compile-schemas

# Compile the GSettings schema so GNOME Shell can load it.
# Prerequisite: glib-compile-schemas must be installed.
compile-schemas:
	glib-compile-schemas $(SCHEMA_DIR)/

# Install extension files into the user's GNOME Shell extension directory.
install: compile-schemas
	mkdir -p $(INSTALL_DIR)
	cp -r metadata.json extension.js prefs.js stylesheet.css \
	      lib icons schemas $(INSTALL_DIR)/
	@echo "Installed to $(INSTALL_DIR)"
	@echo "Restart GNOME Shell (Alt+F2 → 'r') or log out to activate."

# Remove the installed extension.
uninstall:
	rm -rf $(INSTALL_DIR)
	@echo "Uninstalled $(UUID)"

# Run Jest unit tests for the pure-JS library modules.
test:
	npm test

# Run ESLint on all testable source files.
lint:
	npm run lint

# Check npm dependencies for known security vulnerabilities.
audit:
	npm run audit

# Full verification: lint → audit → test.
test-all: lint audit test
	@echo "All checks passed."

# Remove compiled schemas and node_modules artefacts.
clean:
	rm -f $(SCHEMA_DIR)/gschemas.compiled
	rm -rf node_modules
