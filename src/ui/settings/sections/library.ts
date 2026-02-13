import { Setting, Notice, Modal, App } from "obsidian";
import type AbstractFolderPlugin from "main";
import { AuthService } from "../../../library/services/auth-service";

export function renderLibrarySettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	new Setting(containerEl).setName("Abstract library").setHeading();

	new Setting(containerEl)
		.setName("Virtual root folder")
		.setDesc("The folder name used to display your remote libraries in the abstract folder view. These libraries are stored in a high-performance virtual layer and do not clutter your physical vault.")
		.addText((text) =>
			text
				.setPlaceholder("Abstract library")
				.setValue(plugin.settings.librarySettings?.librariesPath || "Abstract Library")
				.onChange(async (value) => {
					plugin.settings.librarySettings.librariesPath = value;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName("GitHub authentication")
		.setDesc("Authenticate with GitHub to access private libraries and contribute.")
		.addButton((btn) =>
			btn
				.setButtonText(plugin.settings.librarySettings?.githubToken ? "Authenticated" : "Login with GitHub")
				.setDisabled(!!plugin.settings.librarySettings?.githubToken)
				.onClick(async () => {
					try {
						const deviceCode = await AuthService.requestDeviceCode();
						const authModal = new (class extends Modal {
							constructor(app: App, code: string, url: string) {
								super(app);
								this.titleEl.setText("GitHub authentication");
								this.contentEl.createEl("p", {
									text: `Please go to ${url} and enter the following code:`,
								});
								this.contentEl.createEl("h2", { text: code, cls: "auth-code" });
								this.contentEl.createEl("p", {
									text: "This window will close automatically once authenticated.",
								});
							}
						})(plugin.app, deviceCode.user_code, deviceCode.verification_uri);

						authModal.open();

						const pollInterval = window.setInterval(() => {
							AuthService.pollForToken(deviceCode.device_code)
								.then(async (token) => {
									if (token) {
										window.clearInterval(pollInterval);
										plugin.settings.librarySettings.githubToken = token;
										await plugin.saveSettings();
										authModal.close();
										new Notice("Successfully authenticated with GitHub!");
										renderLibrarySettings(containerEl, plugin);
									}
								})
								.catch((err: Error) => {
									window.clearInterval(pollInterval);
									authModal.close();
									new Notice("Authentication failed: " + err.message);
								});
						}, deviceCode.interval * 1000);

						authModal.onClose = () => window.clearInterval(pollInterval);
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						new Notice("Failed to start auth flow: " + message);
					}
				}),
		);

	containerEl.createEl("h3", { text: "Abstract library marketplace" });

	new Setting(containerEl)
		.setName("Official registry URL")
		.setDesc("The hardcoded official registry for abstract libraries.")
		.addText((text) =>
			text
				.setPlaceholder("Official URL")
				.setValue("https://raw.githubusercontent.com/RahmaniErfan/abstract-registry/main/directory.json")
				.setDisabled(true),
		);

	new Setting(containerEl)
		.setName("Custom registries")
		.setDesc("Add your own registry link, one per line")
		.addTextArea((text) =>
			text
				.setPlaceholder("https://example.com/registry.json")
				.setValue((plugin.settings.librarySettings?.registries || []).join("\n"))
				.onChange(async (value) => {
					plugin.settings.librarySettings.registries = value
						.split("\n")
						.filter((v) => v.trim() !== "");
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName("Standalone libraries")
		.setDesc("Direct link for standalone libraries")
		.addTextArea((text) =>
			text
				.setPlaceholder("https://github.com/user/repo")
				.setValue((plugin.settings.librarySettings?.standaloneLibraries || []).join("\n"))
				.onChange(async (value) => {
					plugin.settings.librarySettings.standaloneLibraries = value
						.split("\n")
						.filter((v) => v.trim() !== "");
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName("Open library center")
		.setDesc("Discover and install libraries.")
		.addButton((btn) =>
			btn.setButtonText("Open center").onClick(() => {
				void plugin.activateLibraryCenter().catch(console.error);
			}),
		);
}
