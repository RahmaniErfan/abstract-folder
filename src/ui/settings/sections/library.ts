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



	new Setting(containerEl).setName("Abstract Catalog & Marketplace").setHeading();

	const OFFICIAL_CATALOG_URL = "https://raw.githubusercontent.com/RahmaniErfan/abstract-catalog/main/catalog.json";

	new Setting(containerEl)
		.setName("Custom catalogs")
		.setDesc("Add your own catalog URL, one per line. The official Abstract catalog is always included automatically.")
		.addTextArea((text) =>
			text
				.setPlaceholder("https://example.com/catalog.json")
				.setValue((plugin.settings.librarySettings?.catalogs || []).filter((c) => c !== OFFICIAL_CATALOG_URL).join("\n"))
				.onChange(async (value) => {
					plugin.settings.librarySettings.catalogs = value
						.split("\n")
						.filter((v) => v.trim() !== "" && v !== OFFICIAL_CATALOG_URL);
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
