import { Setting, Notice, Modal, App } from "obsidian";
import type AbstractFolderPlugin from "main";
import { AuthService } from "../../../library/services/auth-service";
import { CatalogModal } from "../../modals/catalog-modal";

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
		.setName("Abstract spaces root folder")
		.setDesc("The folder name used to store your collaborative shared spaces. These are active Git repositories synced with your team.")
		.addText((text) =>
			text
				.setPlaceholder("Abstract Spaces")
				.setValue(plugin.settings.librarySettings?.sharedSpacesRoot || "Abstract Spaces")
				.onChange(async (value) => {
					plugin.settings.librarySettings.sharedSpacesRoot = value;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl).setName("Abstract Registry & Marketplace").setHeading();

	containerEl.createEl("h3", { text: "Library Catalog Marketplace" });

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
		.setName("Open official catalog")
		.setDesc("Discover and install libraries.")
		.addButton((btn) =>
			btn.setButtonText("Official Catalog").onClick(() => {
				new CatalogModal(plugin.app, plugin).open();
			}),
		);
}
