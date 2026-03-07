import { Setting } from "obsidian";
import type AbstractFolderPlugin from "main";

export function renderPerformanceSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	new Setting(containerEl).setName("Performance").setHeading();

	new Setting(containerEl)
		.setName("Auto-commit debounce (ms)")
		.setDesc("How long to wait after typing before auto-committing (Default: 5000ms). Lower values sync faster but use more CPU/disk. Minimum 1000ms.")
		.addText((text) =>
			text
				.setPlaceholder("5000")
				.setValue(String(plugin.settings.performance.autoCommitDebounceMs))
				.onChange(async (value) => {
					let parsed = parseInt(value, 10);
					if (isNaN(parsed) || parsed < 1000) parsed = 1000;
					plugin.settings.performance.autoCommitDebounceMs = parsed;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName("Status indicator rest time (ms)")
		.setDesc("How long to wait for idle time before refreshing the git status (Default: 3000ms). Lower values refresh indicators faster but trigger more git commands. Minimum 1000ms.")
		.addText((text) =>
			text
				.setPlaceholder("3000")
				.setValue(String(plugin.settings.performance.statusManagerIdleTimeoutMs))
				.onChange(async (value) => {
					let parsed = parseInt(value, 10);
					if (isNaN(parsed) || parsed < 1000) parsed = 1000;
					plugin.settings.performance.statusManagerIdleTimeoutMs = parsed;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName("Background poll interval (ms)")
		.setDesc("How often to check for external changes in the background (Default: 10000ms). Minimum 5000ms.")
		.addText((text) =>
			text
				.setPlaceholder("10000")
				.setValue(String(plugin.settings.performance.gitScopePollIntervalMs))
				.onChange(async (value) => {
					let parsed = parseInt(value, 10);
					if (isNaN(parsed) || parsed < 5000) parsed = 5000;
					plugin.settings.performance.gitScopePollIntervalMs = parsed;
					await plugin.saveSettings();
				}),
		);
}
