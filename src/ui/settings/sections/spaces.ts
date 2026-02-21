import { Setting } from "obsidian";
import type AbstractFolderPlugin from "main";

export function renderSpacesSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	new Setting(containerEl).setName("Abstract spaces").setHeading();

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
    
    new Setting(containerEl)
        .setName("Shared spaces security")
        .setDesc("Manage security settings for shared spaces.")
        .setHeading();

    new Setting(containerEl)
        .setName("Auto-fetch updates")
        .setDesc("Automatically fetch updates for shared spaces in the background.")
        .addToggle((toggle) =>
            toggle
                .setValue(plugin.settings.librarySettings?.enableScheduledSync || false)
                .onChange(async (value) => {
                    plugin.settings.librarySettings.enableScheduledSync = value;
                    await plugin.saveSettings();
                    plugin.setupSyncScheduler();
                })
        );
}
