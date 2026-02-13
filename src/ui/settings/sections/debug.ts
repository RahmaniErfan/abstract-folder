import { Setting, Notice, Modal, App } from "obsidian";
import type AbstractFolderPlugin from "main";
import { exportDebugDetails } from "../../../utils/debug-exporter";
import { DEFAULT_SETTINGS } from "../../../settings";

export function renderDebugSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	new Setting(containerEl).setName("Debug").setHeading();

	new Setting(containerEl)
		.setName("Anonymize debug export")
		.setDesc(
			"Redact file and folder names in the debug export to protect your privacy. Highly recommended when sharing logs for troubleshooting.",
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.anonymizeDebugExport).onChange(async (value) => {
				plugin.settings.anonymizeDebugExport = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Export debug details")
		.setDesc(
			"Gather diagnostic information into a new folder in your vault. Includes: environment, plugins, settings, vault stats, graph state, logs, and folder structure. Note content is never included.",
		)
		.addButton((button) =>
			button
				.setButtonText("Export debug folder")
				.setIcon("download")
				.onClick(async () => {
					await exportDebugDetails(plugin.app, plugin.settings, plugin.indexer);
				}),
		);

	new Setting(containerEl)
		.setName("Cleanup legacy data")
		.setDesc(
			"If you're experiencing issues after updating from an older version, use this to clean up outdated data from your settings.",
		)
		.addButton((button) =>
			button
				.setButtonText("Cleanup settings")
				.setWarning()
				.onClick(async () => {
					const settingsRecord = plugin.settings as unknown as Record<string, unknown>;
					let cleaned = false;

					if (settingsRecord.views) {
						delete settingsRecord.views;
						cleaned = true;
					}

					if (
						Array.isArray(plugin.settings.expandedFolders) &&
						plugin.settings.expandedFolders.some((f) => typeof f !== "string")
					) {
						plugin.settings.expandedFolders = [];
						cleaned = true;
					}

					if (plugin.settings.metrics && typeof plugin.settings.metrics !== "object") {
						plugin.settings.metrics = {};
						cleaned = true;
					}

					if (cleaned) {
						await plugin.saveSettings();
						new Notice("Legacy data cleaned up.");
					} else {
						new Notice("No legacy data found.");
					}
				}),
		);

	new Setting(containerEl)
		.setName("Factory reset settings")
		.setDesc(
			"Reset all plugin configuration to factory defaults. This is a safe alternative to deleting data.json. It only affects plugin settings like UI preferences and excluded paths. It will not touch your notes or frontmatter properties.",
		)
		.addButton((button) =>
			button
				.setButtonText("Reset all settings")
				.setWarning()
				.onClick(() => {
					const ConfirmModal = class extends Modal {
						constructor(app: App, onConfirm: () => void) {
							super(app);
							this.setTitle("Reset all settings");
							this.contentEl.createEl("p", {
								text: "Are you sure you want to reset all settings? This cannot be undone.",
							});

							new Setting(this.contentEl)
								.addButton((btn) =>
									btn.setButtonText("Cancel").onClick(() => this.close()),
								)
								.addButton((btn) =>
									btn
										.setButtonText("Reset everything")
										.setWarning()
										.onClick(() => {
											onConfirm();
											this.close();
										}),
								);
						}
					};

					new ConfirmModal(plugin.app, () => {
						plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
						plugin
							.saveSettings()
							.then(() => {
								new Notice("Settings have been reset to defaults. Please reload Obsidian.");
							})
							.catch(console.error);
					}).open();
				}),
		);
}
