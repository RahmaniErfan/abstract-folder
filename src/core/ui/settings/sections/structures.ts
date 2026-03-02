import { Setting, setIcon, Notice } from "obsidian";
import type AbstractFolderPlugin from "main";

export async function renderStructuresSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
    containerEl.empty();

    new Setting(containerEl)
        .setName("Global Properties")
        .setHeading()
        .setDesc("Define the default properties to use for parent-child relationships across your vault.");

    new Setting(containerEl)
        .setName("Parent property names")
        .setDesc(
            "The frontmatter property key(s) used to define parent notes (e.g., 'parent', 'up'). Separation with commas. Case-sensitive.",
        )
        .addText((text) =>
            text
                .setPlaceholder("Example: parent, up")
                .setValue(plugin.settings.parentPropertyNames.join(", "))
                .onChange(async (value) => {
                    const propertyNames = value
                        .split(",")
                        .map((v) => v.trim())
                        .filter((v) => v.length > 0);
                    plugin.settings.parentPropertyNames = propertyNames;
                    if (propertyNames.length > 0) {
                        plugin.settings.propertyName = propertyNames[0];
                    }
                    await plugin.saveSettings();
                }),
        );

    new Setting(containerEl)
        .setName("Children property names")
        .setDesc(
            "The frontmatter property key(s) used by a parent to define its children (e.g., 'children', 'sub_notes'). Case-sensitive.",
        )
        .addText((text) =>
            text
                .setPlaceholder("Example: children, members")
                .setValue(plugin.settings.childrenPropertyNames.join(", "))
                .onChange(async (value) => {
                    const propertyNames = value
                        .split(",")
                        .map((v) => v.trim())
                        .filter((v) => v.length > 0);
                    plugin.settings.childrenPropertyNames = propertyNames;
                    if (propertyNames.length > 0) {
                        plugin.settings.childrenPropertyName = propertyNames[0];
                    }
                    await plugin.saveSettings();
                }),
        );

    new Setting(containerEl)
        .setName("Hierarchy Overrides")
        .setHeading()
        .setDesc("The following folders have local configurations that override global settings.");

    const overrideContainer = containerEl.createDiv({ cls: "af-settings-overrides-list" });
    
    const refreshOverrides = async () => {
        overrideContainer.empty();
        const bridge = (plugin as any).abstractBridge;
        if (!bridge) return;

        const configs = await bridge.configResolver.listConfigs();
        
        if (configs.length === 0) {
            overrideContainer.createEl("p", { 
                text: "No local overrides detected. All folders follow global settings.",
                cls: "af-settings-empty-notice"
            });
            return;
        }

        configs.forEach(({ path, type, config }: { path: string, type: 'library' | 'local', config: any }) => {
            const item = overrideContainer.createDiv({ cls: "af-settings-override-item" });
            
            const header = item.createDiv({ cls: "af-override-header" });
            const icon = type === 'library' ? 'library' : 'folder';
            setIcon(header.createDiv({ cls: 'af-override-icon' }), icon);
            header.createDiv({ cls: 'af-override-path', text: path });

            const details = item.createDiv({ cls: "af-override-details" });
            
            const parentProp = config.parentProperty || config.propertyNames?.parent || "Default";
            const childrenProp = config.childrenProperty || config.propertyNames?.children || "Default";
            
            const pRow = details.createDiv({ cls: 'af-override-row' });
            pRow.createSpan({ text: "Parent Property: ", cls: 'af-override-label' });
            pRow.createSpan({ text: parentProp, cls: 'af-override-value' });

            const cRow = details.createDiv({ cls: 'af-override-row' });
            cRow.createSpan({ text: "Children Property: ", cls: 'af-override-label' });
            cRow.createSpan({ text: childrenProp, cls: 'af-override-value' });

            if (config.forceStandardProperties) {
                const sRow = details.createDiv({ cls: 'af-override-row is-strict' });
                setIcon(sRow.createDiv(), 'shield-check');
                sRow.createSpan({ text: "Strict Mode Active", cls: 'af-strict-label' });
            }
        });
    };

    await refreshOverrides();

    new Setting(containerEl)
        .setName("Indexing Controls")
        .setHeading();

    new Setting(containerEl)
        .setName("Refresh Structures")
        .setDesc("Clears the configuration cache and forces the plugin to re-scan for metadata changes. This can resolve UI inconsistencies after manual file moves.")
        .addButton(btn => btn
            .setButtonText("Refresh Now")
            .setIcon("refresh-cw")
            .onClick(async () => {
                const bridge = (plugin as any).abstractBridge;
                if (bridge) {
                    bridge.invalidateCache();
                    bridge.configResolver.clearCache();
                    await refreshOverrides();
                    new Notice("Structure cache cleared and refreshed.");
                }
            })
        );
}
