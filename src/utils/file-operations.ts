import { App, TFile, Notice, TFolder } from "obsidian";
import { AbstractFolderPluginSettings } from "../settings";
import { ChildFileType } from "../ui/modals";
import { FolderIndexer } from "../indexer";
import { AbstractFolderFrontmatter } from "../types";

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
            new Notice(`Unsupported child type: ${childType as string}`);
            return;
    }
    
    const safeChildName = childName.replace(/[\\/:*?"<>|]/g, "");
    
    // Determine the folder path
    let folderPath = ""; // Default to root
    
    // Check if the parent file has a synced physical folder
    if (parentFile) {
        const frontmatter = app.metadataCache.getFileCache(parentFile)?.frontmatter;
        const syncProp = settings.syncPropertyName;
        if (frontmatter && frontmatter[syncProp]) {
            const syncedPath = frontmatter[syncProp];
            if (typeof syncedPath === 'string') {
                folderPath = syncedPath.trim();
                // Ensure folder exists (optional but good practice, though user should have selected valid folder)
                if (!app.vault.getAbstractFileByPath(folderPath)) {
                   await app.vault.createFolder(folderPath);
                }
            }
        }
    }

    let fileName = folderPath ? `${folderPath}/${safeChildName}${fileExtension}` : `${safeChildName}${fileExtension}`;
    let counter = 0;
    while (app.vault.getAbstractFileByPath(fileName)) {
        counter++;
        const namePart = `${safeChildName} ${counter}`;
        fileName = folderPath ? `${folderPath}/${namePart}${fileExtension}` : `${namePart}${fileExtension}`;
    }

    try {
        const file = await app.vault.create(fileName, initialContent);
        new Notice(`Created: ${fileName}`);

        if (fileExtension !== '.md' && parentFile && parentFile.extension === 'md') {
            await app.fileManager.processFrontMatter(parentFile, (frontmatter: AbstractFolderFrontmatter) => {
                const childrenPropertyName = settings.childrenPropertyName;
                const rawChildren = frontmatter[childrenPropertyName];
                let childrenArray: string[] = [];

                if (typeof rawChildren === 'string') {
                    childrenArray = [rawChildren];
                } else if (Array.isArray(rawChildren)) {
                    childrenArray = rawChildren as string[];
                }

                const newChildLink = `[[${file.name}]]`; // Link to the new file, including extension
                if (!childrenArray.includes(newChildLink)) {
                    childrenArray.push(newChildLink);
                }

                frontmatter[childrenPropertyName] = childrenArray.length === 1 ? childrenArray[0] : childrenArray;
            });
        }

        app.workspace.getLeaf(true).openFile(file).catch(console.error);
        app.workspace.trigger('abstract-folder:graph-updated');
    } catch (error) {
        new Notice(`Failed to create file: ${error}`);
        console.error(error);
    }
}

/**
 * Deletes an abstract file, with an option to recursively delete its children.
 * @param app The Obsidian App instance.
 * @param file The TFile to delete.
 * @param deleteChildren If true, recursively deletes all children of this file.
 * @param indexer The FolderIndexer instance to query the graph.
 */
export async function deleteAbstractFile(app: App, file: TFile, deleteChildren: boolean, indexer: FolderIndexer) {
    try {
        if (deleteChildren) {
            const graph = indexer.getGraph();
            const childrenPaths = graph.parentToChildren[file.path];

            if (childrenPaths && childrenPaths.size > 0) {
                for (const childPath of childrenPaths) {
                    const childAbstractFile = app.vault.getAbstractFileByPath(childPath);
                    if (childAbstractFile instanceof TFile) {
                        await deleteAbstractFile(app, childAbstractFile, deleteChildren, indexer);
                    } else if (childAbstractFile instanceof TFolder) {
                        await deleteFolderRecursive(app, childAbstractFile, deleteChildren, indexer);
                    }
                }
            }
        }
        await app.fileManager.trashFile(file);
        new Notice(`Deleted file: ${file.name}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        new Notice(`Failed to delete file ${file.name}: ${errorMessage}`);
        console.error(`Error deleting file ${file.name}:`, error);
    }
}

/**
 * Recursively deletes a folder and its contents.
 * This is a helper for deleteAbstractFile when a child is a folder.
 * @param app The Obsidian App instance.
 * @param folder The TFolder to delete.
 * @param deleteChildren If true, recursively deletes all children of this folder (passed through).
 * @param indexer The FolderIndexer instance to query the graph.
 */
async function deleteFolderRecursive(app: App, folder: TFolder, deleteChildren: boolean, indexer: FolderIndexer) {
    try {
        for (const child of folder.children) {
            if (child instanceof TFile) {
                await deleteAbstractFile(app, child, deleteChildren, indexer);
            } else if (child instanceof TFolder) {
                await deleteFolderRecursive(app, child, deleteChildren, indexer);
            }
        }
        await app.fileManager.trashFile(folder);
        new Notice(`Deleted folder: ${folder.name}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        new Notice(`Failed to delete folder ${folder.name}: ${errorMessage}`);
        console.error(`Error deleting folder ${folder.name}:`, error);
    }
}

/**
 * Updates the 'icon' frontmatter property of a given file.
 * @param app The Obsidian App instance.
 * @param file The TFile to update.
 * @param iconName The name of the icon to set, or empty string to remove.
 */
export async function updateFileIcon(app: App, file: TFile, iconName: string) {
    await app.fileManager.processFrontMatter(file, (frontmatter: AbstractFolderFrontmatter) => {
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
    await app.fileManager.processFrontMatter(file, (frontmatter: AbstractFolderFrontmatter) => {
      const primaryPropertyName = settings.propertyName;
      const rawParents = frontmatter[primaryPropertyName];
      let parentLinks: string[] = [];

      if (typeof rawParents === 'string') {
        parentLinks = [rawParents];
      } else if (Array.isArray(rawParents)) {
        parentLinks = rawParents as string[];
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

/**
 * Moves files to a new abstract parent folder.
 * Handles the logic for MD files (modifying child's parent property)
 * and Non-MD files (modifying parent's children property).
 *
 * @param app The Obsidian App instance.
 * @param settings The plugin settings.
 * @param files The list of files to move.
 * @param targetParentPath The path of the destination abstract folder (parent).
 * @param sourceParentPath The path of the source abstract folder (parent) where the drag started.
 */
export async function moveFiles(
    app: App,
    settings: AbstractFolderPluginSettings,
    files: TFile[],
    targetParentPath: string,
    sourceParentPath: string | null,
    indexer: FolderIndexer,
    isCopy: boolean
) {
    const targetParentFile = app.vault.getAbstractFileByPath(targetParentPath);

    // Validation: If target is a file, it MUST be a Markdown file to act as a parent
    if (targetParentFile instanceof TFile && targetParentFile.extension !== 'md') {
        new Notice("Target must be a Markdown file to contain other files.");
        return;
    }

    // Check if target parent has a synced physical folder
    let targetPhysicalFolder: string | null = null;
    if (targetParentFile instanceof TFile) {
        const frontmatter = app.metadataCache.getFileCache(targetParentFile)?.frontmatter;
        const syncProp = settings.syncPropertyName;
        if (frontmatter && frontmatter[syncProp] && typeof frontmatter[syncProp] === 'string') {
            targetPhysicalFolder = frontmatter[syncProp].trim();
        }
    }

    // Group files by type
    const mdFiles: TFile[] = [];
    const nonMdFiles: TFile[] = [];

    for (const file of files) {
        if (file.extension === 'md') {
            mdFiles.push(file);
        } else {
            nonMdFiles.push(file);
        }
    }

    for (const file of mdFiles) {
        await app.fileManager.processFrontMatter(file, (frontmatter: AbstractFolderFrontmatter) => {
            const parentPropertyName = settings.propertyName;
            const rawParents = frontmatter[parentPropertyName];
            let parentLinks: string[] = [];

            if (typeof rawParents === 'string') {
                parentLinks = [rawParents];
            } else if (Array.isArray(rawParents)) {
                parentLinks = rawParents as string[];
            }

            if (sourceParentPath && !isCopy) {
                const sourceParentFile = app.vault.getAbstractFileByPath(sourceParentPath);
                if (sourceParentFile) {
                    parentLinks = parentLinks.filter(link => {
                        let cleanLink = link.replace(/^["']+|["']+$|^\s+|[\s]+$/g, '');
                        cleanLink = cleanLink.replace(/\[\[|\]\]/g, '');
                        cleanLink = cleanLink.split('|')[0];
                        cleanLink = cleanLink.trim();

                        const linkTargetFile = app.metadataCache.getFirstLinkpathDest(cleanLink, file.path);
                        
                        let isMatch = false;
                        if (linkTargetFile) {
                             isMatch = linkTargetFile.path === sourceParentFile.path;
                        } else {
                            const sourceName = sourceParentFile.name;
                            const sourceBasename = (sourceParentFile instanceof TFile) ? sourceParentFile.basename : sourceParentFile.name;
                            isMatch = cleanLink === sourceName || cleanLink === sourceBasename;
                        }
                        
                        return !isMatch;
                    });
                }
            }

            // Add the new target parent link
            if (targetParentFile) {
                const targetName = (targetParentFile instanceof TFile) ? targetParentFile.basename : targetParentFile.name;
                const newLink = `[[${targetName}]]`;
                if (!parentLinks.includes(newLink)) {
                    parentLinks.push(newLink);
                }
            }

            // Save back
            if (parentLinks.length === 0) {
                delete frontmatter[parentPropertyName];
            } else if (parentLinks.length === 1) {
                frontmatter[parentPropertyName] = parentLinks[0];
            } else {
                frontmatter[parentPropertyName] = parentLinks;
            }
        });
    }

    if (sourceParentPath && nonMdFiles.length > 0 && !isCopy) {
        const sourceParentFile = app.vault.getAbstractFileByPath(sourceParentPath);
        if (sourceParentFile instanceof TFile && sourceParentFile.extension === 'md') {
            await app.fileManager.processFrontMatter(sourceParentFile, (frontmatter: AbstractFolderFrontmatter) => {
                const childrenProp = settings.childrenPropertyName;
                const rawChildren = frontmatter[childrenProp];
                if (!rawChildren) return;
                
                let childrenList: string[] = [];
                if (Array.isArray(rawChildren)) {
                    childrenList = rawChildren as string[];
                } else if (typeof rawChildren === 'string') {
                    childrenList = [rawChildren];
                }
                
                childrenList = childrenList.filter(link => {
                    return !nonMdFiles.some(movedFile =>
                        link.includes(movedFile.name)
                    );
                });

                if (childrenList.length === 0) delete frontmatter[childrenProp];
                else frontmatter[childrenProp] = childrenList.length === 1 ? childrenList[0] : childrenList;
            });
        }
    }

    if (targetParentFile instanceof TFile && targetParentFile.extension === 'md' && nonMdFiles.length > 0) {
         await app.fileManager.processFrontMatter(targetParentFile, (frontmatter: AbstractFolderFrontmatter) => {
            const childrenProp = settings.childrenPropertyName;
            const rawChildren = frontmatter[childrenProp] || [];
            let childrenList: string[] = [];
            if (Array.isArray(rawChildren)) {
                childrenList = rawChildren as string[];
            } else if (typeof rawChildren === 'string') {
                childrenList = [rawChildren];
            }

            for (const file of nonMdFiles) {
                const newLink = `[[${file.name}]]`;
                if (!childrenList.includes(newLink)) {
                    childrenList.push(newLink);
                }
            }

            frontmatter[childrenProp] = childrenList.length === 1 ? childrenList[0] : childrenList;
         });
    } else if (nonMdFiles.length > 0 && (!targetParentFile || !(targetParentFile instanceof TFile) || targetParentFile.extension !== 'md')) {
        new Notice(`Cannot move ${nonMdFiles.length} non-markdown files: Target parent must be a Markdown file.`);
    }

    // Physical Move Logic for Synced Folders
    if (targetPhysicalFolder) {
        for (const file of files) {
            // Determine new path
            const newPath = `${targetPhysicalFolder}/${file.name}`;
            
            // Check if file is already in the target folder
            if (file.parent && file.parent.path === targetPhysicalFolder) {
                continue; // Already there
            }
            
            // Check for collision
            if (app.vault.getAbstractFileByPath(newPath)) {
                new Notice(`Cannot move ${file.name} to synced folder: File with same name exists.`);
                continue;
            }

            try {
                await app.fileManager.renameFile(file, newPath);
                new Notice(`Moved ${file.name} to synced folder: ${targetPhysicalFolder}`);
            } catch (error) {
                console.error(`Failed to move file to synced folder:`, error);
                new Notice(`Failed to move ${file.name} to synced folder.`);
            }
        }
    }

    // Trigger update
    app.workspace.trigger('abstract-folder:graph-updated');
}