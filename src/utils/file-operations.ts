import { App, TFile, Notice, TFolder } from "obsidian";
import { AbstractFolderPluginSettings } from "../settings";
import { ChildFileType } from "../ui/modals";
import { FolderIndexer } from "../indexer";

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

        // Only add to parent's children list if the child is NOT a markdown file (since markdown files define their own parent)
        // AND the parent is a markdown file (so it can have frontmatter)
        if (fileExtension !== '.md' && parentFile && parentFile.extension === 'md') {
            await app.fileManager.processFrontMatter(parentFile, (frontmatter) => {
                const childrenPropertyName = settings.childrenPropertyName;
                const currentChildren = frontmatter[childrenPropertyName];
                let childrenArray: string[] = [];

                if (typeof currentChildren === 'string') {
                    childrenArray = [currentChildren];
                } else if (Array.isArray(currentChildren)) {
                    childrenArray = currentChildren;
                }

                const newChildLink = `[[${file.name}]]`; // Link to the new file, including extension
                if (!childrenArray.includes(newChildLink)) {
                    childrenArray.push(newChildLink);
                }

                frontmatter[childrenPropertyName] = childrenArray.length === 1 ? childrenArray[0] : childrenArray;
            });
        }

        app.workspace.getLeaf(true).openFile(file);
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
                        // Recursively delete children
                        await deleteAbstractFile(app, childAbstractFile, deleteChildren, indexer);
                    } else if (childAbstractFile instanceof TFolder) {
                        // For folders, we need to list its contents and delete them
                        await deleteFolderRecursive(app, childAbstractFile, deleteChildren, indexer);
                    }
                }
            }
        }
        await app.fileManager.trashFile(file);
        new Notice(`Deleted file: ${file.name}`);
    } catch (error) {
        new Notice(`Failed to delete file ${file.name}: ${error.message}`);
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
        new Notice(`Failed to delete folder ${folder.name}: ${error.message}`);
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

    // --- 1. Handle MD Files (Child-Defined Parents) ---
    // For each MD file, we update ITS OWN frontmatter to change the parent pointer.
    for (const file of mdFiles) {
        await app.fileManager.processFrontMatter(file, (frontmatter) => {
            const parentPropertyName = settings.propertyName;
            const currentParents = frontmatter[parentPropertyName];
            let parentLinks: string[] = [];

            // Normalize current parents to array
            if (typeof currentParents === 'string') {
                parentLinks = [currentParents];
            } else if (Array.isArray(currentParents)) {
                parentLinks = currentParents;
            }

            // Remove the old source parent link ONLY if not a copy operation
            if (sourceParentPath && !isCopy) {
                // We need to robustly identify the link to remove (could be [[Note]], [[Note.md]], Note)
                const sourceParentFile = app.vault.getAbstractFileByPath(sourceParentPath);
                if (sourceParentFile) {
                    parentLinks = parentLinks.filter(link => {
                        // Robustly check if the link refers to the sourceParentFile
                        // Remove quotes, brackets, and trim
                        let cleanLink = link.replace(/^["']+|["']+$|^\s+|[\s]+$/g, '');
                        cleanLink = cleanLink.replace(/\[\[|\]\]/g, '');
                        cleanLink = cleanLink.split('|')[0];
                        cleanLink = cleanLink.trim();

                        // Resolve the link to a file to be sure
                        const linkTargetFile = app.metadataCache.getFirstLinkpathDest(cleanLink, file.path);
                        
                        let isMatch = false;
                        if (linkTargetFile) {
                             // Precise match: The link resolves to exactly the sourceParentFile
                             isMatch = linkTargetFile.path === sourceParentFile.path;
                        } else {
                            // Fallback: String match if resolution fails (e.g. file not yet indexed or new)
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

    // --- 2. Handle Non-MD Files (Parent-Defined Children) ---
    // For Non-MD files, we must update the PARENT files (both Source and Target).
    // This requires Source and Target to be Markdown files themselves.
    
    // 2a. Remove from Source Parent (if it exists and is MD) ONLY if not a copy operation
    if (sourceParentPath && nonMdFiles.length > 0 && !isCopy) {
        const sourceParentFile = app.vault.getAbstractFileByPath(sourceParentPath);
        if (sourceParentFile instanceof TFile && sourceParentFile.extension === 'md') {
            await app.fileManager.processFrontMatter(sourceParentFile, (frontmatter) => {
                const childrenProp = settings.childrenPropertyName;
                const children = frontmatter[childrenProp];
                if (!children) return;
                
                let childrenList: string[] = Array.isArray(children) ? children : [children];
                
                // Remove all moved files from this parent's list
                childrenList = childrenList.filter(link => {
                    return !nonMdFiles.some(movedFile =>
                        link.includes(movedFile.name) // Check if link matches any moved file
                    );
                });

                if (childrenList.length === 0) delete frontmatter[childrenProp];
                else frontmatter[childrenProp] = childrenList.length === 1 ? childrenList[0] : childrenList;
            });
        }
    }

    // 2b. Add to Target Parent (if it exists and is MD)
    if (targetParentFile instanceof TFile && targetParentFile.extension === 'md' && nonMdFiles.length > 0) {
         await app.fileManager.processFrontMatter(targetParentFile, (frontmatter) => {
            const childrenProp = settings.childrenPropertyName;
            const children = frontmatter[childrenProp] || [];
            const childrenList: string[] = Array.isArray(children) ? children : [children];

            // Add all non-MD files
            for (const file of nonMdFiles) {
                const newLink = `[[${file.name}]]`; // Must use full name with extension for non-md
                if (!childrenList.includes(newLink)) {
                    childrenList.push(newLink);
                }
            }

            frontmatter[childrenProp] = childrenList.length === 1 ? childrenList[0] : childrenList;
         });
    } else if (nonMdFiles.length > 0 && (!targetParentFile || !(targetParentFile instanceof TFile) || targetParentFile.extension !== 'md')) {
        // Fallback/Warning: Trying to drop non-md files into a container that can't hold them (like root folder or non-md file)
        new Notice(`Cannot move ${nonMdFiles.length} non-markdown files: Target parent must be a Markdown file.`);
    }

    // Trigger update
    app.workspace.trigger('abstract-folder:graph-updated');
}