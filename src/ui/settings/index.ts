import { App, PluginSettingTab } from "obsidian";
import type AbstractFolderPlugin from "main";
import { renderGeneralSettings } from "./sections/general";
import { renderAppearanceSettings } from "./sections/appearance";
import { renderBehaviorSettings } from "./sections/behavior";
import { renderSearchSettings } from "./sections/search";
import { renderGroupSettings } from "./sections/groups";
import { renderLibrarySettings } from "./sections/library";
import { renderDebugSettings } from "./sections/debug";

export class ModularSettingsTab extends PluginSettingTab {
	constructor(app: App, private plugin: AbstractFolderPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		renderGeneralSettings(containerEl, this.plugin);
		renderAppearanceSettings(containerEl, this.plugin);
		renderBehaviorSettings(containerEl, this.plugin);
		renderSearchSettings(containerEl, this.plugin);
		renderGroupSettings(containerEl, this.plugin);
		renderLibrarySettings(containerEl, this.plugin);
		renderDebugSettings(containerEl, this.plugin);
	}
}
