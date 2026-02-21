import { Setting, Notice, Platform } from "obsidian";
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

	const hasGit = await plugin.libraryManager.detectExistingGit("");
	const statusBox = containerEl.createDiv({ cls: "abstract-folder-status-box" });
	statusBox.setAttr("style", "display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 20px; margin-bottom: 24px;");

	const leftArea = statusBox.createDiv();
	leftArea.setAttr("style", "display: flex; align-items: center; gap: 8px;");

	const tag = leftArea.createEl("div", { 
		cls: `status-tag ${hasGit ? 'success' : ''}`
	});
	tag.setAttr("style", "display: flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px;");
	
	import("obsidian").then(({ setIcon }) => {
		setIcon(tag.createDiv(), hasGit ? "check-circle" : "alert-circle");
	});
	tag.createSpan({ text: hasGit ? "Vault Git Initialized" : "Git Not Initialized" });

	if (hasGit) {
		const rightArea = statusBox.createDiv();
		rightArea.setAttr("style", "display: flex; align-items: center; gap: 10px;");

		rightArea.createEl("span", { text: "Your vault is ready to sync." }).setAttr(
			"style", "font-size: var(--font-ui-smaller); color: var(--text-muted);"
		);

		const syncBtn = rightArea.createEl("button", { text: "Sync Now", cls: "mod-cta" });
		syncBtn.setAttr("style", "padding: 4px 16px;");
		syncBtn.addEventListener("click", async () => {
			syncBtn.disabled = true;
			syncBtn.innerText = "Syncing...";
			try {
				await plugin.libraryManager.syncBackup("");
				new Notice("Sync complete");
				renderGitHubSettings(containerEl, plugin);
			} catch (e) {
				new Notice(`Sync failed: ${e.message}`);
				syncBtn.disabled = false;
				syncBtn.innerText = "Sync Now";
			}
		});
	} else {
		const detectedOS = Platform.isWin ? "Windows" : Platform.isMacOS ? "macOS" : "Linux";
		const promptText = `Help me install Git on ${detectedOS}. Keep it simple, explain each command's purpose, and be concise.`;

		// Right side of status bar — short message only
		const rightArea = statusBox.createDiv();
		rightArea.setAttr("style", "display: flex; align-items: center;");
		rightArea.createEl("span", { text: "Install Git to enable vault backup." }).setAttr(
			"style", "font-size: var(--font-ui-smaller); color: var(--text-muted);"
		);

		// Prompt row — sits below the statusBox
		const promptRow = containerEl.createDiv();
		promptRow.setAttr("style",
			"display: flex; align-items: center; gap: 10px; " +
			"margin-top: -16px; margin-bottom: 24px;"
		);

		// Left: prompt text + copy button
		const promptBox = promptRow.createDiv();
		promptBox.setAttr("style",
			"flex: 1; display: flex; align-items: center; gap: 8px; " +
			"background: var(--background-primary-alt); " +
			"border: 1px solid var(--background-modifier-border); " +
			"border-radius: var(--radius-s); padding: 6px 12px;"
		);

		promptBox.createEl("span", { text: promptText }).setAttr("style",
			"flex: 1; font-size: var(--font-ui-smaller); color: var(--text-muted); " +
			"font-family: var(--font-monospace); line-height: 1.4;"
		);

		const copyBtn = promptBox.createEl("button", { text: "Copy" });
		copyBtn.setAttr("style", "flex-shrink: 0; padding: 2px 10px; font-size: var(--font-ui-smaller);");
		copyBtn.addEventListener("click", () => {
			navigator.clipboard.writeText(promptText);
			copyBtn.textContent = "Copied!";
			setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
		});

		// Right: Open Gemini button
		const openLink = promptRow.createEl("a", { text: "✦ Open Gemini" });
		openLink.setAttr("href", "https://gemini.google.com/app");
		openLink.setAttr("target", "_blank");
		openLink.setAttr("rel", "noopener noreferrer");
		openLink.setAttr("style",
			"flex-shrink: 0; text-decoration: none; " +
			"padding: 6px 18px; border-radius: 20px; " +
			"font-size: var(--font-ui-smaller); font-weight: 600; " +
			"display: inline-flex; align-items: center; gap: 6px; " +
			"background: linear-gradient(135deg, #4f82f7, #9b72f5); " +
			"color: #fff; border: none; " +
			"box-shadow: 0 2px 8px rgba(99, 102, 241, 0.35); " +
			"transition: filter 0.15s ease, box-shadow 0.15s ease; " +
			"white-space: nowrap; cursor: pointer;"
		);
		openLink.addEventListener("mouseenter", () => {
			openLink.style.filter = "brightness(1.12)";
			openLink.style.boxShadow = "0 4px 14px rgba(99, 102, 241, 0.5)";
		});
		openLink.addEventListener("mouseleave", () => {
			openLink.style.filter = "";
			openLink.style.boxShadow = "0 2px 8px rgba(99, 102, 241, 0.35)";
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
