#  Created by Deepak Sharma on 13/07/2026.

# XBridge — build & distribution automation.

# Read name/version straight from package.json so the VSIX name stays in sync.
NAME      := $(shell node -p "require('./package.json').name")
VERSION   := $(shell node -p "require('./package.json').version")
BUILD_DIR := builds
VSIX      := $(BUILD_DIR)/$(NAME)-$(VERSION).vsix
VSCE      := npx --yes @vscode/vsce

.DEFAULT_GOAL := help

.PHONY: help install compile watch check lint package vsix install-ext uninstall-ext publish clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install npm dependencies
	npm install

compile: ## Type-check and bundle (development build)
	npm run compile

watch: ## Rebuild on change
	npm run watch

check: ## Type-check only
	npm run check-types

lint: ## Run eslint
	npm run lint

package: ## Production bundle (no VSIX)
	npm run package

vsix: package ## Build the distributable VSIX into builds/
	@mkdir -p $(BUILD_DIR)
	$(VSCE) package -o $(VSIX)
	@echo "Built $(VSIX)"

CODE      := $(shell which code 2>/dev/null || echo "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")

install-ext: vsix ## Build the VSIX and install it into VS Code
	"$(CODE)" --install-extension $(VSIX) --force

uninstall-ext: ## Remove the extension from VS Code
	"$(CODE)" --uninstall-extension $(shell node -p "require('./package.json').publisher").$(NAME)

publish: ## Publish to the VS Code Marketplace (requires VSCE_PAT)
	$(VSCE) publish

clean: ## Remove build artifacts
	rm -rf dist *.vsix $(BUILD_DIR)
