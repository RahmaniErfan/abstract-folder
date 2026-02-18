import { App, setIcon } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import type AbstractFolderPlugin from "main";
import { ContextEngine } from "../../core/context-engine";
import { Logger } from "../../utils/logger";

export interface AbstractSearchOptions {
    containerEl: HTMLElement;
    placeholder?: string;
    onSearch?: (query: string) => void;
    showAncestryToggles?: boolean;
}

export class AbstractSearch {
    private searchInput: HTMLInputElement;
    private clearSearchBtn: HTMLElement;
    private showAncestorsBtn: HTMLElement | undefined;
    private showDescendantsBtn: HTMLElement | undefined;

    constructor(
        private app: App,
        private plugin: AbstractFolderPlugin,
        private settings: AbstractFolderPluginSettings,
        private contextEngine: ContextEngine,
        private options: AbstractSearchOptions
    ) {}

    public render(): void {
        const { containerEl, placeholder = "Search..." } = this.options;
        containerEl.empty();
        containerEl.addClass("abstract-folder-search-container");

        const searchInputWrapper = containerEl.createDiv({ cls: "abstract-folder-search-input-wrapper" });
        this.searchInput = searchInputWrapper.createEl("input", {
            type: "text",
            placeholder: placeholder,
            cls: "abstract-folder-search-input"
        });

        this.clearSearchBtn = searchInputWrapper.createDiv({
            cls: "abstract-folder-search-clear",
            attr: { "aria-label": "Clear search" }
        });
        setIcon(this.clearSearchBtn, "x");

        this.updateClearButtonState();

        this.searchInput.addEventListener("input", () => {
             const query = this.searchInput.value;
             this.contextEngine.setFilter(query);
             this.updateClearButtonState();
             this.options.onSearch?.(query);
        });

        this.clearSearchBtn.addEventListener("click", () => {
            this.clear();
        });

        if (this.options.showAncestryToggles !== false) {
             this.renderAncestryToggles(containerEl);
        }
    }

    private renderAncestryToggles(container: HTMLElement) {
        this.showAncestorsBtn = container.createDiv({
            cls: "clickable-icon ancestry-search-toggle",
            attr: { "aria-label": "Show all ancestors in search" }
        });
        setIcon(this.showAncestorsBtn, "arrow-up-left");
        if (this.settings.searchShowAncestors) this.showAncestorsBtn.addClass("is-active");

        this.showAncestorsBtn.addEventListener("click", async () => {
            this.settings.searchShowAncestors = !this.settings.searchShowAncestors;
            this.showAncestorsBtn?.toggleClass("is-active", this.settings.searchShowAncestors);
            await this.saveSettings();
            // Trigger refresh via context change if needed, or callback
            this.contextEngine.emit('changed', this.contextEngine.getState());
        });

        this.showDescendantsBtn = container.createDiv({
            cls: "clickable-icon ancestry-search-toggle",
            attr: { "aria-label": "Show all descendants in search" }
        });
        setIcon(this.showDescendantsBtn, "arrow-down-right");
        if (this.settings.searchShowDescendants) this.showDescendantsBtn.addClass("is-active");

        this.showDescendantsBtn.addEventListener("click", async () => {
            this.settings.searchShowDescendants = !this.settings.searchShowDescendants;
            this.showDescendantsBtn?.toggleClass("is-active", this.settings.searchShowDescendants);
            await this.saveSettings();
             this.contextEngine.emit('changed', this.contextEngine.getState());
        });
    }

    public setValue(value: string) {
        if (this.searchInput) {
            this.searchInput.value = value;
            this.contextEngine.setFilter(value);
            this.updateClearButtonState();
        }
    }

    public clear() {
        this.setValue("");
        this.searchInput.focus();
        this.options.onSearch?.("");
    }

    public focus() {
        this.searchInput?.focus();
    }

    private updateClearButtonState() {
        if (!this.clearSearchBtn || !this.searchInput) return;
        const hasQuery = this.searchInput.value.length > 0;
        this.clearSearchBtn.toggleClass("is-active", hasQuery);
    }
    
    // Helper to save settings. Ideally context engine or plugin handles this, 
    // but settings are global so we can write to them. 
    // We need a way to save. 
    // We can assume plugin is available in context or pass a save callback.
    // For now we will assume the caller handles saving if we emit change, 
    // OR we need to inject the plugin/save mechanism.
    // The previous implementation called `plugin.saveSettings()`.
    // Let's add a `saveSettings` method to the options or rely on reference updates.
    // Actually, `settings` object is passed by reference, so we update it in memory.
    // But persistence requires a call.
    // Let's check `AbstractFolderToolbar` deps. It has `plugin`.
    // Let's add `plugin` to `AbstractSearch` deps too to be safe/consistent.
    
    private async saveSettings() {
        if (this.plugin && this.plugin.saveSettings) {
            await this.plugin.saveSettings();
        }
    }
}
