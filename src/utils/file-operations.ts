import { App, TFile, Notice } from "obsidian";
import { AbstractFolderPluginSettings } from "../settings";
import { ChildFileType } from "../ui/modals";

/**
 * Creates a new abstract child file (note, canvas, or base) with appropriate frontmatter and content.
 * @param app The Obsidian App instance.
 * @param settings The plugin settings.
 * @param childName The name of the new child file.
 * @param parentFile The parent TFile, if creating a child for an existing parent.
 * @param childType The type of child file to create ('note', 'canvas', 'base').
 */
export async function createAbstractChildFile(app: App, settings: AbstractFolderPluginSettings, childName: string, parentFile: TFile | null, childType: ChildFileType) {
    let fileExtension: string;
    let initialContent: string;

    switch (childType) {
        case 'note':
            fileExtension = '.md';
            if (parentFile) {
                const parentBaseName = parentFile.basename;
                const cleanParentName = parentBaseName.replace(/"/g, '');
                initialContent = `---
${settings.propertyName}: "[[${cleanParentName}]]"
aliases:
  - "${childName}"
---
`;
            } else {
                initialContent = `---
aliases:
  - "${childName}"
---
`;
            }
            break;
        case 'canvas':
            fileExtension = '.canvas';
            initialContent = `{
  "nodes": [],
  "edges": []
}`;
            break;
        case 'base':
            fileExtension = '.base';
            initialContent = `{}`;
            break;
        default:
            new Notice(`Unsupported child type: ${childType}`);
            return;
    }
    
    const safeChildName = childName.replace(/[\\/:*?"<>|]/g, "");
    let fileName = `${safeChildName}${fileExtension}`;
    let counter = 0;
    while (app.vault.getAbstractFileByPath(fileName)) {
        counter++;
        fileName = `${safeChildName} ${counter}${fileExtension}`;
    }

    try {
        const file = await app.vault.create(fileName, initialContent);
        new Notice(`Created: ${fileName}`);


        app.workspace.getLeaf(true).openFile(file);
        app.workspace.trigger('abstract-folder:graph-updated');
    } catch (error) {
        new Notice(`Failed to create file: ${error}`);
        console.error(error);
    }
}

/**
 * Updates the 'icon' frontmatter property of a given file.
 * @param app The Obsidian App instance.
 * @param file The TFile to update.
 * @param iconName The name of the icon to set, or empty string to remove.
 */
export async function updateFileIcon(app: App, file: TFile, iconName: string) {
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (iconName) {
        frontmatter.icon = iconName;
      } else {
        delete frontmatter.icon;
      }
    });
    app.workspace.trigger('abstract-folder:graph-updated');
}

/**
 * Toggles the 'hidden' status of a note by adding/removing 'hidden' from its parent property.
 * @param app The Obsidian App instance.
 * @param file The TFile to update.
 * @param settings The plugin settings to get the propertyName.
 */
export async function toggleHiddenStatus(app: App, file: TFile, settings: AbstractFolderPluginSettings) {
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      const primaryPropertyName = settings.propertyName;
      const currentParents = frontmatter[primaryPropertyName];
      let parentLinks: string[] = [];

      if (typeof currentParents === 'string') {
        parentLinks = [currentParents];
      } else if (Array.isArray(currentParents)) {
        parentLinks = currentParents;
      }

      const isCurrentlyHidden = parentLinks.some((p: string) => p.toLowerCase().trim() === 'hidden');

      if (isCurrentlyHidden) {
        const newParents = parentLinks.filter((p: string) => p.toLowerCase().trim() !== 'hidden');
        
        if (newParents.length > 0) {
          frontmatter[primaryPropertyName] = newParents.length === 1 ? newParents[0] : newParents;
        } else {
          delete frontmatter[primaryPropertyName];
        }
        new Notice(`Unhid: ${file.basename}`);
      } else {
        if (!parentLinks.some((p: string) => p.toLowerCase().trim() === 'hidden')) {
          parentLinks.push('hidden');
        }
        frontmatter[primaryPropertyName] = parentLinks.length === 1 ? parentLinks[0] : parentLinks;
        new Notice(`Hid: ${file.basename}`);
      }
    });
    app.workspace.trigger('abstract-folder:graph-updated');
}