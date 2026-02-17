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
		.setName("GitHub Personal Access Token")
		.setDesc("Authenticate with a PAT to access private libraries and contribute.")
		.addText((text) =>
			text
				.setPlaceholder("ghp_xxxxxxxxxxxx")
				.setValue(plugin.settings.librarySettings?.githubToken || "")
				.onChange(async (value) => {
					const trimmed = value.trim();
					plugin.settings.librarySettings.githubToken = trimmed;
					await plugin.saveSettings();
					
					if (trimmed) {
						const userInfo = await AuthService.getUserInfo(trimmed);
						if (userInfo) {
							new Notice(`Authenticated as ${userInfo.login}`);
							renderLibrarySettings(containerEl, plugin); // Re-render to show username
						} else {
							new Notice("Warning: GitHub token validation failed. Check your token and scopes.");
						}
					}
				}),
		)
		.addButton((btn) => 
			btn
				.setButtonText("Generate Token")
				.setTooltip("Generate a token on GitHub with 'repo' scope")
				.onClick(() => {
					window.open("https://github.com/settings/tokens/new?scopes=repo&description=Abstract%20Folder%20Token");
				})
		);

	if (plugin.settings.librarySettings.githubToken) {
		void (async () => {
			const token = plugin.settings.librarySettings.githubToken;
			if (token) {
				const userInfo = await AuthService.getUserInfo(token);
				if (userInfo) {
					new Setting(containerEl)
						.setName("Authenticated as")
						.setDesc(userInfo.login)
						.addButton((btn) =>
							btn.setButtonText("Logout").onClick(async () => {
								plugin.settings.librarySettings.githubToken = "";
								await plugin.saveSettings();
								renderLibrarySettings(containerEl, plugin);
							}),
						);
				}
			}
		})();
	}

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
