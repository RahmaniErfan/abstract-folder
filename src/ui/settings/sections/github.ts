import { Setting, Notice } from "obsidian";
import type AbstractFolderPlugin from "main";

export function renderGitHubSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	containerEl.empty();
	new Setting(containerEl).setName("GitHub Authentication").setHeading();

	new Setting(containerEl)
		.setName("GitHub Personal Access Token")
		.setDesc("Authenticate with a PAT to access private libraries and contribute.")
		.addText((text) => {
			text.inputEl.type = "password";
			text.setPlaceholder("ghp_xxxxxxxxxxxx")
				.setValue(plugin.settings.librarySettings.githubToken || "")
				.onChange(async (value) => {
					plugin.settings.librarySettings.githubToken = value.trim();
					await plugin.saveSettings();
					
					if (!plugin.settings.librarySettings.githubToken) return;

					const userInfo = await plugin.libraryManager.refreshIdentity();
					if (userInfo) {
						new Notice(`Authenticated as ${userInfo.login}`);
						renderGitHubSettings(containerEl, plugin); // Re-render to show username
					}
				});
		})
		.addButton((btn) => 
			btn
				.setButtonText("Generate Token")
				.setTooltip("Generate a token on GitHub with 'repo' and 'user' scope")
				.onClick(() => {
					window.open("https://github.com/settings/tokens/new?scopes=repo,user&description=Abstract%20Folder%20Token");
				})
		);

	const warningEl = containerEl.createDiv({ cls: "af-settings-warning" });
	warningEl.createEl("strong", { text: "Security Note: " });
	warningEl.createSpan({ 
		text: "Tokens are stored locally in your vault's settings. Avoid sharing your vault with untrustworthy parties." 
	});
	warningEl.style.fontSize = "var(--font-ui-smaller)";
	warningEl.style.color = "var(--text-warning)";
	warningEl.style.padding = "var(--size-4-2) var(--size-4-3)";
	warningEl.style.borderLeft = "2px solid var(--interactive-accent)";
	warningEl.style.backgroundColor = "var(--background-secondary-alt)";
	warningEl.style.borderRadius = "var(--radius-s)";
	warningEl.style.marginTop = "var(--size-4-4)";
	warningEl.style.marginBottom = "var(--size-4-4)";
	warningEl.style.border = "1px solid var(--text-warning)";
	warningEl.style.fontWeight = "500";
	warningEl.style.textAlign = "center";

	if (plugin.settings.librarySettings.githubUsername) {
		const username = plugin.settings.librarySettings.githubUsername;
		new Setting(containerEl)
			.setName("Authenticated as")
			.setDesc(username)
			.addButton((btn) =>
				btn
					.setButtonText("Refresh Profile")
					.setTooltip("Refresh your Git author details from GitHub")
					.onClick(async () => {
						const updated = await plugin.libraryManager.refreshIdentity();
						if (updated) {
							new Notice("Profile details refreshed!");
							renderGitHubSettings(containerEl, plugin);
						} else {
							new Notice("Failed to refresh profile.");
						}
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Logout").onClick(async () => {
					plugin.settings.librarySettings.githubToken = "";
					plugin.settings.librarySettings.githubUsername = "";
					plugin.settings.librarySettings.githubAvatar = "";
					plugin.settings.librarySettings.gitName = "";
					plugin.settings.librarySettings.gitEmail = "";
					await plugin.saveSettings();
					renderGitHubSettings(containerEl, plugin);
				}),
			);
			
		new Setting(containerEl).setName("Git Author Info").setHeading();

		new Setting(containerEl)
			.setName("Git author name")
			.setDesc("Used for commits. Automatically fetched, but you can override it.")
			.addText((text) =>
				text
					.setPlaceholder("Your Name")
					.setValue(plugin.settings.librarySettings.gitName || "")
					.onChange(async (value) => {
						plugin.settings.librarySettings.gitName = value;
						await plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Git author email")
			.setDesc("Used for commits. Matches commits to your GitHub account.")
			.addText((text) =>
				text
					.setPlaceholder("email@example.com")
					.setValue(plugin.settings.librarySettings.gitEmail || "")
					.onChange(async (value) => {
						plugin.settings.librarySettings.gitEmail = value;
						await plugin.saveSettings();
					}),
			);
	}
}
