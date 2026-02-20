import { Setting, Notice } from "obsidian";
import type AbstractFolderPlugin from "main";

export async function renderGitHubSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	containerEl.empty();

	// Test if SecretStorage ACTUALLY works (sometimes present but broken on Linux)
	let isSecretStorageAvailable = false;
	let requiresAppBinding = false;
	const secretStorage = (plugin.app as any).secretStorage;
	if (secretStorage && typeof secretStorage.getSecret === 'function') {
		try {
			await secretStorage.getSecret('af-test-key');
			isSecretStorageAvailable = true;
		} catch (e: any) {
			if (e instanceof TypeError && e.message.includes('not a function')) {
				try {
					await secretStorage.getSecret.call(plugin.app, 'af-test-key');
					isSecretStorageAvailable = true;
					requiresAppBinding = true;
				} catch (e2) {
					console.warn("[Abstract Folder] SecretStorage context fallback failed.", e2);
				}
			} else {
				console.warn("[Abstract Folder] SecretStorage is present but threw an error during viability check. Falling back to unsafe storage.", e);
			}
		}
	}

	if (isSecretStorageAvailable) {
		const securityDisclaimer = containerEl.createDiv({ cls: "af-settings-disclaimer" });
		securityDisclaimer.style.fontSize = "var(--font-ui-smaller)";
		securityDisclaimer.style.color = "var(--text-success)";
		securityDisclaimer.style.padding = "var(--size-4-2) var(--size-4-3)";
		securityDisclaimer.style.border = "1px solid var(--text-success)";
		securityDisclaimer.style.borderRadius = "var(--radius-s)";
		securityDisclaimer.style.backgroundColor = "var(--background-secondary-alt)";
		securityDisclaimer.style.marginTop = "var(--size-4-4)";
		securityDisclaimer.style.marginBottom = "var(--size-4-4)";
		securityDisclaimer.style.fontWeight = "500";
		securityDisclaimer.style.textAlign = "center";
		
		securityDisclaimer.createEl("strong", { text: "Security Note: " });
		securityDisclaimer.createSpan({ 
			text: "Your GitHub token will be securely encrypted via your operating system's keychain. It is never saved to your local vault files." 
		});

	} else {
		const warningEl = containerEl.createDiv({ cls: "af-settings-warning" });
		warningEl.style.fontSize = "var(--font-ui-smaller)";
		warningEl.style.color = "var(--text-warning)";
		warningEl.style.padding = "var(--size-4-3)";
		warningEl.style.border = "1px solid var(--text-warning)";
		warningEl.style.borderRadius = "var(--radius-s)";
		warningEl.style.backgroundColor = "var(--background-secondary-alt)";
		warningEl.style.marginTop = "var(--size-4-4)";
		warningEl.style.marginBottom = "var(--size-4-4)";
		warningEl.style.textAlign = "center";
		
		warningEl.createEl("strong", { text: "Unsafe Storage Warning: " });
		warningEl.createSpan({ 
			text: "Your token will be saved to your local vault settings because Obsidian's native SecretStorage is unavailable or broken. Please update Obsidian." 
		});
	}

	new Setting(containerEl).setName("GitHub Authentication").setHeading();

	new Setting(containerEl)
		.setName("GitHub Personal Access Token")
		.setDesc("Authenticate with a PAT to access private libraries and contribute.")
		.addText(async (text) => {
			text.inputEl.type = "password";
			
			let savedToken = plugin.settings.librarySettings.githubToken;
			if (isSecretStorageAvailable) {
				if (requiresAppBinding) {
					savedToken = await secretStorage.getSecret.call(plugin.app, 'abstract-folder-github-pat');
				} else {
					savedToken = await secretStorage.getSecret('abstract-folder-github-pat');
				}
			}
			
			text.setPlaceholder("ghp_xxxxxxxxxxxx")
				.setValue(savedToken || "")
				.onChange(async (value) => {
					const token = value.trim();
					
					if (isSecretStorageAvailable) {
						// Some Obsidian versions use storeSecret, some might use setSecret. Try both.
						const setFnName = typeof secretStorage.storeSecret === 'function' ? 'storeSecret' : 'setSecret';
						const setFn = secretStorage[setFnName];
						if (setFn) {
							if (requiresAppBinding) {
								await setFn.call(plugin.app, 'abstract-folder-github-pat', token);
							} else {
								await setFn.call(secretStorage, 'abstract-folder-github-pat', token);
							}
						}
						
						// Clear old plaintext token
						if (plugin.settings.librarySettings.githubToken) {
							plugin.settings.librarySettings.githubToken = "";
							await plugin.saveSettings();
						}
					} else {
						plugin.settings.librarySettings.githubToken = token;
						await plugin.saveSettings();
					}

					if (!token) return;

					const userInfo = await plugin.libraryManager.refreshIdentity(token);
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
