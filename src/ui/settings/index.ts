import { App, PluginSettingTab, setIcon } from "obsidian";
import type AbstractFolderPlugin from "main";
import { renderGeneralSettings } from "./sections/general";
import { renderAppearanceSettings } from "./sections/appearance";
import { renderBehaviorSettings } from "./sections/behavior";
import { renderGitHubSettings } from "./sections/github";
import { renderLibrarySettings } from "./sections/library";
import { renderDebugSettings } from "./sections/debug";
import { renderStructuresSettings } from "./sections/structures";

type SettingsTabId = 'general' | 'appearance' | 'behavior' | 'structures' | 'github' | 'library' | 'debug';

interface SettingsTabConfig {
	id: SettingsTabId;
	name: string;
	icon: string;
	render: (containerEl: HTMLElement, plugin: AbstractFolderPlugin) => void;
}

export class ModularSettingsTab extends PluginSettingTab {
	private activeTab: SettingsTabId = 'general';

	private configs: SettingsTabConfig[] = [
		{ id: 'general', name: 'General', icon: 'settings-2', render: renderGeneralSettings },
		{ id: 'appearance', name: 'Appearance', icon: 'palette', render: renderAppearanceSettings },
		{ id: 'behavior', name: 'Behavior', icon: 'zap', render: renderBehaviorSettings },
		{ id: 'structures', name: 'Structures', icon: 'folder-tree', render: renderStructuresSettings },
		{ id: 'github', name: 'GitHub', icon: 'github', render: renderGitHubSettings },
		{ id: 'library', name: 'Library', icon: 'library', render: renderLibrarySettings },
		{ id: 'debug', name: 'Debug', icon: 'bug', render: renderDebugSettings },
	];

	constructor(app: App, private plugin: AbstractFolderPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderTabs(containerEl);

		const contentEl = containerEl.createDiv({ cls: 'abstract-folder-settings-section' });

		try {
			const activeConfig = this.configs.find(c => c.id === this.activeTab);
			if (activeConfig) {
				activeConfig.render(contentEl, this.plugin);
			}
		} catch (e) {
			console.error("Failed to render settings section", e);
			contentEl.createEl("p", { text: "Error loading settings. Check console for details.", cls: "error-text" });
		}
	}

	private renderTabs(containerEl: HTMLElement): void {
		const tabContainer = containerEl.createDiv({ cls: 'abstract-folder-settings-tabs' });

		this.configs.forEach(config => {
			const tabBtn = tabContainer.createDiv({
				cls: `abstract-folder-settings-tab-button ${this.activeTab === config.id ? 'is-active' : ''}`
			});

			const iconEl = tabBtn.createDiv({ cls: 'abstract-folder-settings-tab-icon' });
			setIcon(iconEl, config.icon);

			tabBtn.createDiv({
				cls: 'abstract-folder-settings-tab-label',
				text: config.name
			});

			tabBtn.onClickEvent(() => {
				this.activeTab = config.id;
				this.display();
				this.containerEl.scrollTo(0, 0);
			});
		});
	}
}
