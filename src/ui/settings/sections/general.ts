import { Setting, AbstractInputSuggest, normalizePath, TFolder, setIcon, Notice } from "obsidian";
import type AbstractFolderPlugin from "main";

export class PathInputSuggest extends AbstractInputSuggest<string> {
	constructor(
		private plugin: AbstractFolderPlugin, 
		private inputEl: HTMLInputElement,
		private options?: {
			scopePath?: string;
			extension?: string;
			includeFolders?: boolean;
			includeFiles?: boolean;
			excludePaths?: string[];
		}
	) {
		super(plugin.app, inputEl);
	}

	getSuggestions(inputStr: string): string[] {
		const abstractFiles = this.plugin.app.vault.getAllLoadedFiles();
		const suggestions: string[] = [];
		const lowerCaseInputStr = inputStr.toLowerCase();

		const { scopePath, extension, includeFolders = true, includeFiles = true, excludePaths = [] } = this.options || {};

		abstractFiles.forEach((file) => {
			const filePath = file.path;
			const isFolder = file instanceof TFolder;
			const isFile = !isFolder;

			// 1. Filter by Scope
			if (scopePath) {
				const isExactMatch = filePath === scopePath;
				const isChildMatch = filePath.startsWith(scopePath + "/");
				if (!isExactMatch && !isChildMatch) {
					return;
				}
			}

			// 1b. Filter out explicitly excluded paths
			if (excludePaths.some(p => filePath === p || filePath.startsWith(p + "/"))) {
				return;
			}

			// 2. Filter by Search Query
			if (!filePath.toLowerCase().contains(lowerCaseInputStr)) {
				return;
			}

			// 3. Filter by Type (File vs Folder)
			if (isFolder && !includeFolders) return;
			if (isFile && !includeFiles) return;

			// 4. Filter by Extension
			if (isFile && extension && !filePath.endsWith(extension)) {
				return;
			}

			suggestions.push(filePath);
		});

		return suggestions.slice(0, 50); // Limit to 50 suggestions
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		this.inputEl.value = value;
		this.inputEl.trigger("input");
		this.close();
	}
}

export function renderGeneralSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
    renderSupportBanner(containerEl.createDiv(), plugin);
	new Setting(containerEl)
		.setName("Created date field names")
		.setDesc(
			"Set the field name in frontmatter to use for the created date (support multiple field names, separated by commas).",
		)
		.addText((text) =>
			text
				.setPlaceholder("Example: created, ctime")
				.setValue(plugin.settings.customCreatedDateProperties)
				.onChange(async (value) => {
					plugin.settings.customCreatedDateProperties = value;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName("Modified date field names")
		.setDesc(
			"Set the field name in frontmatter to use for the modified date (support multiple field names, separated by commas).",
		)
		.addText((text) =>
			text
				.setPlaceholder("Example: modified, updated, mtime")
				.setValue(plugin.settings.customModifiedDateProperties)
				.onChange(async (value) => {
					plugin.settings.customModifiedDateProperties = value;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl).setName("Display name").setHeading();

	new Setting(containerEl)
		.setName("Show aliases")
		.setDesc("Use the first alias from the 'aliases' frontmatter property as the display name.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showAliases).onChange(async (value) => {
				plugin.settings.showAliases = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Display name priority")
		.setDesc(
			"Determine the priority for displaying names. Use frontmatter property names (e.g., 'title'), 'aliases' for the first alias, or 'basename' for the filename. Separate with commas.",
		)
		.addText((text) =>
			text
				.setPlaceholder("Example: title, aliases, basename")
				.setValue(plugin.settings.displayNameOrder.join(", "))
				.onChange(async (value) => {
					plugin.settings.displayNameOrder = value
						.split(",")
						.map((v) => v.trim())
						.filter((v) => v.length > 0);
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl).setName("Startup & layout").setHeading();

	new Setting(containerEl)
		.setName("Default new note path")
		.setDesc(
			"The folder where new root-level notes will be created. Defaults to 'Abstract Notes'. Abstract Library and Abstract Spaces are managed separately.",
		)
		.addText((text) => {
			text.setPlaceholder("Abstract Notes")
				.setValue(plugin.settings.defaultNewNotePath)
				.onChange(async (value) => {
					plugin.settings.defaultNewNotePath = normalizePath(value);
					await plugin.saveSettings();
				});
			const libraryRoot = plugin.settings.librarySettings?.librariesPath || "Abstract Library";
			const spacesRoot = plugin.settings.librarySettings?.sharedSpacesRoot || "Abstract Spaces";
			new PathInputSuggest(plugin, text.inputEl, {
				includeFolders: true,
				includeFiles: false,
				excludePaths: [libraryRoot, spacesRoot],
			});
		});

	new Setting(containerEl)
		.setName("Open on startup")
		.setDesc("Automatically open the abstract folders view when Obsidian starts.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.startupOpen).onChange(async (value) => {
				plugin.settings.startupOpen = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Open position")
		.setDesc("Which side sidebar to open the view in.")
		.addDropdown((dropdown) =>
			dropdown
				.addOption("left", "Left")
				.addOption("right", "Right")
				.setValue(plugin.settings.openSide)
				.onChange(async (value: "left" | "right") => {
					plugin.settings.openSide = value;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName("Show ribbon icon")
		.setDesc("Toggle the visibility of the abstract folders icon in the left ribbon.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showRibbonIcon).onChange(async (value) => {
				plugin.settings.showRibbonIcon = value;
				await plugin.saveSettings();
			}),
		);

	renderExcludedPaths(containerEl, plugin);
}

function renderExcludedPaths(containerEl: HTMLElement, plugin: AbstractFolderPlugin): void {
	new Setting(containerEl)
		.setName("Excluded paths")
		.setDesc("The plugin will ignore these folders and their contents.")
		.setHeading();

	const excludedPathsContainer = containerEl.createDiv({
		cls: "abstract-folder-excluded-paths-container",
	});

	const renderList = () => {
		excludedPathsContainer.empty();
		plugin.settings.excludedPaths.forEach((path, index) => {
			new Setting(excludedPathsContainer)
				.addText((text) => {
					text.setPlaceholder("Path to exclude");
					text.setValue(path);
					new PathInputSuggest(plugin, text.inputEl);
					text.onChange(async (value) => {
						plugin.settings.excludedPaths[index] = normalizePath(value);
						await plugin.saveSettings();
					});
				})
				.addButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Remove path")
						.onClick(async () => {
							plugin.settings.excludedPaths.splice(index, 1);
							await plugin.saveSettings();
							renderList();
						}),
				);
		});
	};

	renderList();

	new Setting(containerEl).addExtraButton((button) =>
		button
			.setIcon("plus")
			.setTooltip("Add new excluded path")
			.onClick(async () => {
				plugin.settings.excludedPaths.push(normalizePath(""));
				await plugin.saveSettings();
				renderList();
			}),
	);
}

async function renderSupportBanner(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
    containerEl.empty();
    const banner = containerEl.createDiv({ cls: "af-settings-support-banner" });
    
    const header = banner.createDiv({ cls: "af-support-header" });
    setIcon(header, "heart");
    header.createSpan({ text: "Support Abstract Folder" });
    
    banner.createDiv({ 
        cls: "af-support-text", 
        text: "Abstract Folder is developed by a single developer with the invaluable help of the community in finding bugs and suggesting improvements. If you find it useful, consider supporting the journey!" 
    });

    const buttons = banner.createDiv({ cls: "af-support-buttons" });

    // GitHub Star
    const starBtn = buttons.createDiv({ cls: "af-support-btn is-star" });
    setIcon(starBtn, "star");
    starBtn.createSpan({ text: "Star" });
    starBtn.onClickEvent(async () => {
        if (starBtn.hasClass("is-starred")) {
            window.open("https://github.com/RahmaniErfan/abstract-folder", "_blank");
            return;
        }

        const token = await (plugin.libraryManager as any).getToken();
        if (!token) {
            window.open("https://github.com/RahmaniErfan/abstract-folder", "_blank");
            return;
        }
        
        try {
            const { AuthService } = await import("../../../library/services/auth-service");
            const success = await AuthService.starRepository(token, "RahmaniErfan", "abstract-folder");
            if (success) {
                new Notice("Successfully starred Abstract Folder! Thank you!");
                starBtn.addClass("is-starred");
                starBtn.querySelector("span")!.textContent = "Starred";
            } else {
                window.open("https://github.com/RahmaniErfan/abstract-folder", "_blank");
            }
        } catch (e) {
            window.open("https://github.com/RahmaniErfan/abstract-folder", "_blank");
        }
    });

    // Sponsor
    const ghSponsor = buttons.createDiv({ cls: "af-support-btn is-github" });
    setIcon(ghSponsor, "heart-handshake");
    ghSponsor.createSpan({ text: "Sponsor" });
    ghSponsor.onClickEvent(() => window.open("https://github.com/sponsors/RahmaniErfan", "_blank"));

    // Coffee
    const coffee = buttons.createDiv({ cls: "af-support-btn is-coffee" });
    setIcon(coffee, "coffee");
    coffee.createSpan({ text: "Coffee" });
    coffee.onClickEvent(() => window.open("https://buymeacoffee.com/erfanrahmani", "_blank"));

    // Try to check if already starred
    try {
        const token = await (plugin.libraryManager as any).getToken();
        if (token) {
            const { AuthService } = await import("../../../library/services/auth-service");
            const isStarred = await AuthService.isStarred(token, "RahmaniErfan", "abstract-folder");
            if (isStarred) {
                starBtn.addClass("is-starred");
                starBtn.querySelector("span")!.textContent = "Starred";
            }
        }
    } catch (e) {}
}
