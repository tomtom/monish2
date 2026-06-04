# Makefile for the Monish GNOME Shell extension.
#
# Targets:
#   compile-schemas  Compile GSettings XML into a binary schema cache.
#   install          Install the extension to the user's GNOME extension dir.
#   uninstall        Remove the installed extension.
#   zip              Build a ZIP for upload to extensions.gnome.org.
#   test             Run Jest unit tests (pure JS logic).
#   lint             Run ESLint on lib/ and test/.
#   audit            Check npm dependencies for known vulnerabilities.
#   test-all         Run lint, audit, and test in sequence.
#   shexli           Build ZIP and validate it with shexli.
#   clean            Remove generated artefacts.

UUID        := monish2@thm.link
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMA_DIR  := schemas

.PHONY: all compile-schemas compile-translations install uninstall zip shexli test lint audit test-all clean

all: compile-schemas compile-translations

# Compile the GSettings schema so GNOME Shell can load it.
# Prerequisite: glib-compile-schemas must be installed.
compile-schemas:
	glib-compile-schemas $(SCHEMA_DIR)/

# Compile .po files to binary .mo files for each language.
# Prerequisite: msgfmt (gettext) must be installed.
compile-translations:
	@for po in po/*.po; do \
		lang=$$(basename $$po .po); \
		mkdir -p locale/$$lang/LC_MESSAGES; \
		msgfmt -o locale/$$lang/LC_MESSAGES/$(UUID).mo $$po; \
	done

# Install extension files into the user's GNOME Shell extension directory.
install: compile-schemas compile-translations
	mkdir -p $(INSTALL_DIR)
	cp -r metadata.json extension.js prefs.js stylesheet.css \
	      lib icons schemas locale $(INSTALL_DIR)/
	@echo "Installed to $(INSTALL_DIR)"
	@echo "Restart GNOME Shell (Alt+F2 → 'r') or log out to activate."

# Build a ZIP suitable for upload to extensions.gnome.org.
zip: compile-schemas compile-translations
	rm -f $(UUID).shell-extension.zip
	$(eval DISTDIR := $(shell mktemp -d))
	cp extension.js metadata.json prefs.js stylesheet.css $(DISTDIR)/
	cp -r lib icons schemas locale $(DISTDIR)/
	rm -f $(DISTDIR)/schemas/gschemas.compiled
	cd $(DISTDIR) && zip -r $(CURDIR)/$(UUID).shell-extension.zip \
		metadata.json extension.js prefs.js stylesheet.css lib icons schemas locale
	rm -rf $(DISTDIR)
	@echo "Created $(UUID).shell-extension.zip"

# Validate the packed extension with shexli.
shexli: zip
	shexli $(UUID).shell-extension.zip

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

# Remove compiled schemas, compiled translations, and node_modules artefacts.
clean:
	rm -f $(SCHEMA_DIR)/gschemas.compiled
	rm -f $(UUID).shell-extension.zip
	rm -rf node_modules
	rm -rf locale
