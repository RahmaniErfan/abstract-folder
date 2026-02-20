import { Setting } from "obsidian";
import type AbstractFolderPlugin from "main";
import { VisibilitySettings } from "../../../settings";

export function renderAppearanceSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	containerEl.empty();
	new Setting(containerEl).setName("Appearance").setHeading();

	new Setting(containerEl)
		.setName("Enable rainbow indents")
		.setDesc("Enable rainbow indentation guides.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.enableRainbowIndents).onChange(async (value) => {
				plugin.settings.enableRainbowIndents = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
				renderAppearanceSettings(containerEl, plugin); // Re-render to update visibility
			}),
		);

	const rainbowGroup = containerEl.createDiv({ 
		cls: `af-settings-rainbow-group ${!plugin.settings.enableRainbowIndents ? 'is-disabled' : ''}` 
	});

	new Setting(rainbowGroup)
		.setName("Rainbow palette")
		.setDesc("The color palette for rainbow indents.")
		.addDropdown((dropdown) =>
			dropdown
				.addOption("classic", "Classic")
				.addOption("pastel", "Pastel")
				.addOption("neon", "Neon")
				.setValue(plugin.settings.rainbowPalette)
				.onChange(async (value: "classic" | "pastel" | "neon") => {
					plugin.settings.rainbowPalette = value;
					await plugin.saveSettings();
					plugin.app.workspace.trigger("abstract-folder:graph-updated");
				}),
		);

	new Setting(rainbowGroup)
		.setName("Enable per-item rainbow colors")
		.setDesc("Use varied colors for indentation guides of sibling items.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.enablePerItemRainbowColors).onChange(async (value) => {
				plugin.settings.enablePerItemRainbowColors = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl).setName("Icons").setHeading();
	new Setting(containerEl)
		.setName("Show file icon")
		.setDesc("Whether to show the default file icon.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showFileIcon).onChange(async (value) => {
				plugin.settings.showFileIcon = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Show folder icon")
		.setDesc("Whether to show the default folder icon.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showFolderIcon).onChange(async (value) => {
				plugin.settings.showFolderIcon = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Max menu name length")
		.setDesc("Maximum length of file names shown in menus and dropdowns.")
		.addSlider((slider) =>
			slider
				.setLimits(5, 50, 1)
				.setValue(plugin.settings.maxMenuNameLength)
				.setDynamicTooltip()
				.onChange(async (value) => {
					plugin.settings.maxMenuNameLength = value;
					await plugin.saveSettings();
				}),
		);

	const visibilityHeader = containerEl.createDiv({ cls: "af-settings-visibility-header" });
	visibilityHeader.createDiv({ cls: "af-settings-visibility-title", text: "Visibility" });
	const visibilityContent = containerEl.createDiv({ cls: "af-settings-visibility-content" });

	let activeView: keyof typeof plugin.settings.visibility = "default";

	const renderVisibilityControls = (viewType: keyof typeof plugin.settings.visibility) => {
		visibilityContent.empty();
		const config = plugin.settings.visibility[viewType];

		const createToggle = (name: string, desc: string, key: keyof VisibilitySettings) => {
			new Setting(visibilityContent)
				.setName(name)
				.setDesc(desc)
				.addToggle((toggle) =>
					toggle.setValue(config[key as string]).onChange(async (value) => {
						config[key as string] = value;
						await plugin.saveSettings();
						plugin.app.workspace.trigger("abstract-folder:graph-updated");
					}),
				);
		};

		createToggle("Show search header", "Show the search bar and filter/sort buttons.", "showSearchHeader");
		createToggle("Show focus active file button", "Show the button to focus the active file.", "showFocusActiveFileButton");
		createToggle("Show create note button", "Show the button to create a new note.", "showCreateNoteButton");
		createToggle("Show group button", "Show the button to manage groups.", "showGroupButton");
		createToggle("Show filter button", "Show the button to filter files.", "showFilterButton");
		createToggle("Show sort button", "Show the button to change sorting.", "showSortButton");
		createToggle("Show expand all button", "Show the button to expand all folders.", "showExpandAllButton");
		createToggle("Show collapse all button", "Show the button to collapse all folders.", "showCollapseAllButton");
		createToggle("Show conversion button", "Show the button to convert folders.", "showConversionButton");
	};

	const tabContainer = visibilityHeader.createDiv({ cls: "af-visibility-tabs" });
	const views: { id: keyof typeof plugin.settings.visibility; name: string }[] = [
		{ id: "default", name: "Default" },
		{ id: "spaces", name: "Spaces" },
		{ id: "libraries", name: "Library Catalog" },
	];

	views.forEach((view) => {
		const tabBtn = tabContainer.createDiv({
			cls: `af-visibility-tab ${activeView === view.id ? "is-active" : ""}`,
			text: view.name,
		});
		tabBtn.onClickEvent(() => {
			activeView = view.id;
			tabContainer.querySelectorAll(".af-visibility-tab").forEach((el) => el.removeClass("is-active"));
			tabBtn.addClass("is-active");
			renderVisibilityControls(activeView);
		});
	});

	renderVisibilityControls(activeView);
}
