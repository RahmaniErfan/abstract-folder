import { Setting, Notice, Modal, App, normalizePath } from "obsidian";
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
					await exportDebugDetails(plugin.app, plugin.settings, plugin.graphEngine);
				}),
		);

	new Setting(containerEl)
		.setName("Cleanup legacy data")
		.setDesc(
			"If you're experiencing issues after updating, use this to reset your settings to defaults in memory and re-index. This is a safe first step.",
		)
		.addButton((button) =>
			button
				.setButtonText("Reset settings")
				.setWarning()
				.onClick(async () => {
					const ConfirmModal = class extends Modal {
						constructor(app: App, onConfirm: () => Promise<void>) {
							super(app);
							this.setTitle("Reset all settings");
							this.contentEl.createEl("p", {
								text: "Are you sure you want to reset all settings? This will clear all configuration, including your GitHub tokens and custom groups. This cannot be undone.",
							});

							new Setting(this.contentEl)
								.addButton((btn) =>
									btn.setButtonText("Cancel").onClick(() => this.close()),
								)
								.addButton((btn) =>
									btn
										.setButtonText("Reset everything")
										.setWarning()
										.onClick(async () => {
											await onConfirm();
											this.close();
										}),
								);
						}
					};

					new ConfirmModal(plugin.app, async () => {
						for (const key in plugin.settings) {
							delete (plugin.settings as any)[key];
						}
						Object.assign(plugin.settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
						plugin.metricsManager.clear();
						
						try {
							await plugin.saveSettings();
							await plugin.graphEngine.forceReindex();
							new Notice("Settings have been reset to defaults.");
						} catch (e) {
							console.error("[Abstract Folder] Reset failed:", e);
							new Notice("Failed to reset settings.");
						}
					}).open();
				}),
		);

	new Setting(containerEl)
		.setName("Hard factory reset")
		.setDesc(
			"The 'Nuclear Option'. This creates a backup of your data.json and then physically deletes it from your plugin folder. Use this if the standard reset doesn't fix your issues.",
		)
		.addButton((button) =>
			button
				.setButtonText("Delete data.json & backup")
				.setWarning()
				.onClick(async () => {
					const ConfirmModal = class extends Modal {
						constructor(app: App, onConfirm: () => Promise<void>) {
							super(app);
							this.setTitle("Hard Factory Reset");
							this.contentEl.createEl("p", {
								text: "This will physically delete your data.json file. A backup (data.json.bak) will be created in your plugin folder. You will need to reload Obsidian for this to take full effect.",
							});

							new Setting(this.contentEl)
								.addButton((btn) =>
									btn.setButtonText("Cancel").onClick(() => this.close()),
								)
								.addButton((btn) =>
									btn
										.setButtonText("Delete & Backup")
										.setWarning()
										.onClick(async () => {
											await onConfirm();
											this.close();
										}),
								);
						}
					};

					new ConfirmModal(plugin.app, async () => {
						const configDir = plugin.app.vault.configDir;
						const pluginId = plugin.manifest.id;
						const pluginDir = normalizePath(`${configDir}/plugins/${pluginId}`);
						const dataPath = `${pluginDir}/data.json`;
						const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
						const backupPath = `${pluginDir}/data.json.${timestamp}.bak`;

						try {
							const adapter = plugin.app.vault.adapter;
							if (await adapter.exists(dataPath)) {
								await adapter.copy(dataPath, backupPath);
								await adapter.remove(dataPath);
								new Notice(`data.json backed up to ${backupPath} and deleted.`);
							} else {
								new Notice("data.json not found on disk.");
							}

							// Reset in-memory too
							for (const key in plugin.settings) {
								delete (plugin.settings as any)[key];
							}
							Object.assign(plugin.settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
							plugin.metricsManager.clear();
							
							new Notice("Plugin state reset. Please restart Obsidian.");
						} catch (e) {
							console.error("[Abstract Folder] Hard reset failed:", e);
							new Notice("Hard reset failed. See console for details.");
						}
					}).open();
				}),
		);
}
