import { Setting } from "obsidian";
import type AbstractFolderPlugin from "main";
import { ManageGroupsModal } from "../../modals/manage-groups-modal";

export function renderGroupSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	new Setting(containerEl).setName("Groups").setHeading();

	new Setting(containerEl)
		.setName("Open groups manager")
		.setDesc("Manage your custom groups.")
		.addButton((button) =>
			button
				.setButtonText("Open")
				.onClick(async () => {
					new ManageGroupsModal(plugin.app, plugin.settings, (updatedGroups, activeGroupId) => {
						plugin.settings.groups = updatedGroups;
						plugin.settings.activeGroupId = activeGroupId;
						void plugin.saveSettings().then(() => {
							plugin.app.workspace.trigger('abstract-folder:group-changed');
						});
					}, plugin).open();
				})
		);
}
