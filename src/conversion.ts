import { App, TFolder, TFile, TAbstractFile, Notice } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";
import { FolderIndexer } from "./indexer";

export interface ConversionOptions {
    createParentNotes: boolean;
    existingRelationshipsStrategy: 'append' | 'replace';
    folderNoteStrategy: 'outside' | 'inside'; // 'outside' = parent note is sibling of folder; 'inside' = parent note is inside folder
}

export interface GenerationOptions {
    destinationPath: string;
    conflictResolution: 'duplicate' | 'resolve'; // 'resolve' implies specific choices per file
}

export interface FileConflict {
    file: TFile;
    targetPaths: string[];
    resolution?: 'duplicate' | string; // 'duplicate' or the specific target path to use
}

/**
 * Converts the physical folder structure into the plugin's abstract folder format.
 */
export async function convertFoldersToPluginFormat(
    app: App,
    settings: AbstractFolderPluginSettings,
    rootFolder: TFolder,
    options: ConversionOptions
): Promise<void> {
    new Notice("Starting folder to plugin conversion...");
    let updatedCount = 0;
    const filesToProcess: TFile[] = [];

    // Recursively collect all markdown files within the rootFolder
    const collectFiles = (folder: TFolder) => {
        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === 'md') {
                filesToProcess.push(child);
            } else if (child instanceof TFolder) {
                collectFiles(child);
            }
        }
    };

    collectFiles(rootFolder);

    const allFoldersInScope: TFolder[] = [];

    const collectFolders = (folder: TFolder) => {
        allFoldersInScope.push(folder);
        for (const child of folder.children) {
            if (child instanceof TFolder) {
                collectFolders(child);
            }
        }
    };
    collectFolders(rootFolder);

    // First pass: Create parent notes for all folders and link regular files to them
    for (const folder of allFoldersInScope) {
        if (folder === rootFolder && rootFolder.parent === null) { // Handle vault root case
            // If the rootFolder is the actual vault root, don't try to create a parent note for it based on a parent folder.
            // Files directly in the vault root won't have a conceptual parent from the folder structure.
            continue;
        }

        console.log(`[Abstract Folder] Processing folder for parent note creation and file linking: ${folder.path}`);
        let potentialParentNotePath = "";
        if (options.folderNoteStrategy === 'inside') {
            potentialParentNotePath = `${folder.path}/${folder.name}.md`;
        } else {
            const parentOfCurrentFolder = folder.parent;
            if (parentOfCurrentFolder && parentOfCurrentFolder.path !== '/') {
                potentialParentNotePath = `${parentOfCurrentFolder.path}/${folder.name}.md`;
            } else {
                potentialParentNotePath = `${folder.name}.md`;
            }
        }

        let folderNote = app.vault.getAbstractFileByPath(potentialParentNotePath) as TFile;

        if (!folderNote && options.createParentNotes) {
            console.log(`[Abstract Folder] Attempting to create folder note for ${folder.path} at ${potentialParentNotePath}`);
            try {
                folderNote = await app.vault.create(potentialParentNotePath, "");
                updatedCount++;
                console.log(`[Abstract Folder] Created folder note: ${folderNote.path}`);
            } catch (e) {
                console.warn(`[Abstract Folder] Could not create folder note at ${potentialParentNotePath} for folder ${folder.path}`, e);
                // If we can't create it, we can't link to it, so continue
                continue;
            }
        }

        if (folderNote) {
            // Link immediate files and folders within this folder to the folderNote
            for (const child of folder.children) {
                if (child instanceof TFile) {
                    if (child.extension === 'md' && child.path !== folderNote.path) {
                        console.log(`[Abstract Folder] Linking markdown file ${child.path} to folder note ${folderNote.path}`);
                        await linkChildToParent(app, settings, child, folderNote, options.existingRelationshipsStrategy);
                        updatedCount++;
                    } else if (child.path !== folderNote.path) {
                        // Non-markdown file: only add to parent note's children, not vice-versa
                        console.log(`[Abstract Folder] Adding non-markdown file ${child.path} to children of folder note ${folderNote.path}`);
                        await addChildToParentNoteFrontmatter(app, settings, child, folderNote);
                        updatedCount++;
                    }
                } else if (child instanceof TFolder) {
                    // Folders will be linked in the second pass, but for now, we can add them as children to the immediate parent's folder note
                    // This creates the link from ParentFolder.md -> ChildFolder (as a link).
                    // The ChildFolder.md -> ParentFolder.md link is handled in the second pass.
                    // This ensures that "subfolders" are seen as children of their parent's folder note.
                    console.log(`[Abstract Folder] Adding folder ${child.path} to children of folder note ${folderNote.path}`);
                    await addChildToParentNoteFrontmatter(app, settings, child, folderNote);
                    updatedCount++;
                }
            }
        }
    }

    // Second pass: Link folder notes to their conceptual parent folder notes
    // This establishes the hierarchy between abstract folders themselves
    for (const folder of allFoldersInScope) {
        if (folder === rootFolder && rootFolder.parent === null) {
            continue;
        }
        
        const parentOfCurrentFolder = folder.parent;
        if (!parentOfCurrentFolder || parentOfCurrentFolder === rootFolder) {
            // If this folder's parent is the root of the conversion or no parent,
            // its conceptual parent note (if any) is already considered a top-level abstract folder.
            continue;
        }

        console.log(`[Abstract Folder] Processing folder note hierarchy for: ${folder.path}`);

        // Get the folder note for the current folder
        let currentFolderNotePath = "";
        if (options.folderNoteStrategy === 'inside') {
            currentFolderNotePath = `${folder.path}/${folder.name}.md`;
        } else {
            if (parentOfCurrentFolder && parentOfCurrentFolder.path !== '/') {
                currentFolderNotePath = `${parentOfCurrentFolder.path}/${folder.name}.md`;
            } else {
                currentFolderNotePath = `${folder.name}.md`;
            }
        }
        const currentFolderNote = app.vault.getAbstractFileByPath(currentFolderNotePath) as TFile;

        if (!currentFolderNote) {
            console.log(`[Abstract Folder] No folder note found for ${folder.path}, cannot establish hierarchy.`);
            continue;
        }

        // Get the folder note for the parent folder
        let parentFolderNotePath = "";
        if (options.folderNoteStrategy === 'inside') {
            parentFolderNotePath = `${parentOfCurrentFolder.path}/${parentOfCurrentFolder.name}.md`;
        } else {
            const grandParentOfCurrentFolder = parentOfCurrentFolder.parent;
            if (grandParentOfCurrentFolder && grandParentOfCurrentFolder.path !== '/') {
                parentFolderNotePath = `${grandParentOfCurrentFolder.path}/${parentOfCurrentFolder.name}.md`;
            } else {
                parentFolderNotePath = `${parentOfCurrentFolder.name}.md`;
            }
        }
        const parentFolderNote = app.vault.getAbstractFileByPath(parentFolderNotePath) as TFile;

        if (parentFolderNote && currentFolderNote.path !== parentFolderNote.path) {
            console.log(`[Abstract Folder] Linking folder note ${currentFolderNote.path} to parent folder note ${parentFolderNote.path}`);
            await linkChildToParent(app, settings, currentFolderNote, parentFolderNote, options.existingRelationshipsStrategy);
            updatedCount++;
        } else {
            console.log(`[Abstract Folder] Cannot link folder note ${currentFolderNote.path} to its parent (no parent folder note found or self-link).`);
        }
    }

    new Notice(`Conversion complete. Updated ${updatedCount} relationships.`);
    app.workspace.trigger('abstract-folder:graph-updated');
}

async function addChildToParentNoteFrontmatter(
    app: App,
    settings: AbstractFolderPluginSettings,
    childFile: TAbstractFile, // Can be TFile or TFolder
    parentNote: TFile
) {
    await app.fileManager.processFrontMatter(parentNote, (frontmatter) => {
        const childrenPropertyName = settings.childrenPropertyName || "children";
        let currentChildren = frontmatter[childrenPropertyName] || [];

        if (typeof currentChildren === 'string') {
            currentChildren = [currentChildren];
        } else if (!Array.isArray(currentChildren)) {
            if (currentChildren) currentChildren = [String(currentChildren)];
            else currentChildren = [];
        }

        // Use the basename for the link, regardless of file type
        const childLink = `[[${childFile.name}]]`; // Use 'name' property which is common to TFile and TFolder

        if (!currentChildren.includes(childLink)) {
            currentChildren.push(childLink);
        }
        frontmatter[childrenPropertyName] = currentChildren;
    });
}
 
async function linkChildToParent(
    app: App,
    settings: AbstractFolderPluginSettings,
    child: TFile,
    parent: TFile,
    strategy: 'append' | 'replace'
) {
    // 1. Update CHILD to point to PARENT (propertyName)
    await app.fileManager.processFrontMatter(child, (frontmatter) => {
        const parentPropertyName = settings.propertyName || "parent";
        let currentParents = frontmatter[parentPropertyName] || [];

        // Normalize to array
        if (typeof currentParents === 'string') {
            currentParents = [currentParents];
        } else if (!Array.isArray(currentParents)) {
             // Handle potential weirdness or single value
             if (currentParents) currentParents = [String(currentParents)];
             else currentParents = [];
        }

        const parentLink = `[[${parent.basename}]]`;

        if (strategy === 'replace') {
            currentParents = [parentLink];
        } else {
             if (!currentParents.includes(parentLink)) {
                currentParents.push(parentLink);
            }
        }
        
        frontmatter[parentPropertyName] = currentParents;
    });

    // 2. Update PARENT to point to CHILD (childrenPropertyName) - This will be handled by the new addChildToParentNoteFrontmatter for both MD and non-MD
    // This part of linkChildToParent is now redundant and will be removed as the new helper function is more generic
    // for updating parent's children.
    // I will remove this block in the next diff.
}
/**
 * Generates a physical folder structure from the plugin's abstract folder format.
 * This function prepares the operations but does not execute them until confirmed.
 */
export async function generateFolderStructurePlan(
    app: App,
    settings: AbstractFolderPluginSettings,
    indexer: FolderIndexer,
    destinationPath: string,
    placeIndexFileInside: boolean,
    rootScope?: TFile
): Promise<{ fileTree: Map<string, string[]>, conflicts: FileConflict[] }> {
    const fileTree = new Map<string, string[]>(); // FolderPath -> List of FilePaths to move/copy there
    const conflicts: FileConflict[] = [];
    const fileDestinations = new Map<string, string[]>(); // FilePath -> List of target folder paths

    // 1. Get the graph from the indexer
    const graph = indexer.getGraph();
    const parentToChildrenMap = graph.parentToChildren;

    // Helper to get children of a single file from the graph
    const getChildren = (file: TFile): Set<TFile> => {
        const childrenFiles = new Set<TFile>();
        const childPaths = parentToChildrenMap[file.path];
        
        if (childPaths) {
            childPaths.forEach(path => {
                const childFile = app.vault.getAbstractFileByPath(path);
                if (childFile instanceof TFile) {
                    childrenFiles.add(childFile);
                }
            });
        }
        return childrenFiles;
    };

    // 2. Map files to their new folders
    const processNode = (file: TFile, currentPath: string, visited: Set<string>) => {
        if (visited.has(file.path)) return; // Cycle detection
        visited.add(file.path);

        // This file 'file' acts as a folder at 'currentPath'
        const children = getChildren(file);
        
        if (children && children.size > 0) {
            const newFolderPath = `${currentPath}/${file.basename}`;
            
            // If placeIndexFileInside is true, we put the PARENT file inside the new folder too
            if (placeIndexFileInside) {
                if (!fileDestinations.has(file.path)) fileDestinations.set(file.path, []);
                
                // If we are moving it inside, we should remove it from the currentPath (outside)
                // to avoid duplication (having it both outside and inside)
                const targets = fileDestinations.get(file.path)!;
                const outsideIndex = targets.indexOf(currentPath);
                if (outsideIndex > -1) {
                    targets.splice(outsideIndex, 1);
                }
                
                // We add it to the new folder.
                targets.push(newFolderPath);
            } else {
                // If placeIndexFileInside is FALSE (OFF), the user wants a pure folder structure.
                // This means the parent file itself should NOT be included in the export (it becomes just a folder).
                // We must remove the file from its currently assigned destination (outside/sibling).
                
                 const targets = fileDestinations.get(file.path);
                 if (targets) {
                     const outsideIndex = targets.indexOf(currentPath);
                     if (outsideIndex > -1) {
                         targets.splice(outsideIndex, 1);
                     }
                 }
            }

            for (const child of children) {
                if (child.path === file.path) continue; // Prevent self-reference loops

                // Record that 'child' belongs in 'newFolderPath'
                if (!fileDestinations.has(child.path)) fileDestinations.set(child.path, []);
                fileDestinations.get(child.path)!.push(newFolderPath);

                // Recurse
                processNode(child, newFolderPath, new Set(visited));
            }
        }
    };

    if (rootScope) {
        // Handle the rootScope file itself: put it in destinationPath
        if (!fileDestinations.has(rootScope.path)) fileDestinations.set(rootScope.path, []);
        fileDestinations.get(rootScope.path)!.push(destinationPath);

        // Process children
        processNode(rootScope, destinationPath, new Set());
    } else {
        // Identify roots for full vault export
        // For full vault export, we need to find root nodes in the graph
        // A root node is a node that is a parent but has no parents itself (or at least not within the set of parents)
        
        const allParents = Object.keys(parentToChildrenMap);
        const allChildren = new Set<string>();
        
        // Collect all files that are children of someone
        for (const parent of allParents) {
             const children = parentToChildrenMap[parent];
             if (children) {
                 children.forEach(c => allChildren.add(c));
             }
        }

        // Roots are parents that are NOT children of anyone
        const roots = allParents.filter(p => !allChildren.has(p));
        
        console.log(`[Abstract Folder] Found ${roots.length} root nodes for export.`);

        for (const rootPath of roots) {
            const rootFile = app.vault.getAbstractFileByPath(rootPath);
            if (rootFile instanceof TFile) {
                // Ensure the root file itself is moved to the destination
                if (!fileDestinations.has(rootFile.path)) fileDestinations.set(rootFile.path, []);
                fileDestinations.get(rootFile.path)!.push(destinationPath);

                processNode(rootFile, destinationPath, new Set());
            }
        }
    }
    
    // 3. Identify conflicts
    for (const [filePath, targetFolders] of fileDestinations.entries()) {
        const file = app.vault.getAbstractFileByPath(filePath) as TFile;
        // Deduplicate target folders
        const uniqueTargets = [...new Set(targetFolders)];
        
        if (uniqueTargets.length > 1) {
            conflicts.push({
                file,
                targetPaths: uniqueTargets,
                resolution: 'duplicate' // Default
            });
        }
        
        // Add to final plan (fileTree)
        // We initially add all targets. Resolution will filter this later.
        uniqueTargets.forEach(folder => {
            if (!fileTree.has(folder)) fileTree.set(folder, []);
            fileTree.get(folder)!.push(filePath);
        });
    }

    // Also add non-conflicting files to fileTree if not already added
    // (Done above in loop)

    return { fileTree, conflicts };
}

/**
 * Executes the folder generation plan.
 */
export async function executeFolderGeneration(
    app: App,
    plan: { fileTree: Map<string, string[]>, conflicts: FileConflict[] }
): Promise<void> {
    const { fileTree, conflicts } = plan;
    console.log(`[Abstract Folder] Executing Generation. Folders to create: ${fileTree.size}`);
    
    // Resolve conflicts map for easy lookup
    const conflictMap = new Map<string, FileConflict>();
    conflicts.forEach(c => conflictMap.set(c.file.path, c));

    // Helper to recursively create folders
    const createFolderRecursively = async (path: string) => {
        const parts = path.split('/');
        let currentPath = "";
        for (const part of parts) {
            if (!part) continue;
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const existing = app.vault.getAbstractFileByPath(currentPath);
            if (!existing) {
                try {
                    await app.vault.createFolder(currentPath);
                    console.log(`[Abstract Folder] Created folder: ${currentPath}`);
                } catch (error) {
                    // Ignore error if it already exists (race condition) or handled
                     const check = app.vault.getAbstractFileByPath(currentPath);
                     if (!check) {
                         console.error(`[Abstract Folder] Failed to create folder ${currentPath}:`, error);
                     }
                }
            }
        }
    };

    for (const [folderPath, filePaths] of fileTree.entries()) {
        console.log(`[Abstract Folder] Processing folder: ${folderPath}`);
        
        // 1. Create Folder (Recursively)
        await createFolderRecursively(folderPath);

        // 2. Move/Copy Files
        for (const filePath of filePaths) {
            const file = app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const conflict = conflictMap.get(filePath);
                let action = 'copy'; // Default for safety? Or move if no conflict?
                
                // If it's a conflict and resolution is 'resolve' (pick one), we check if THIS folder is the chosen one.
                if (conflict) {
                    if (conflict.resolution === 'duplicate') {
                        action = 'copy';
                    } else if (conflict.resolution === folderPath) {
                        action = 'move'; // Or copy? If we move, we can't put it in other places.
                        // Wait, if "Pick Primary", we only put it in ONE place.
                        // So the other entries in fileTree for this file should have been removed?
                        // YES. The plan passed to this function should ALREADY be resolved.
                        // But let's assume the UI modifies the 'plan' object directly or we filter here.
                    } else {
                        // This folder was NOT chosen. Skip.
                        continue;
                    }
                } else {
                    // No conflict. Single parent.
                    // We should COPY by default to avoid destroying the user's current vault structure?
                    // "Plugin to Folder" -> "Create folder structure".
                    // If we MOVE, we dismantle the original location.
                    // Let's default to COPY for safety, or make it an option.
                    // For now: COPY.
                    action = 'copy';
                }

                const newFilePath = `${folderPath}/${file.name}`;
                if (action === 'copy') {
                     await app.vault.copy(file, newFilePath);
                } else {
                    // move
                    await app.fileManager.renameFile(file, newFilePath);
                }
            }
        }
    }
    
    new Notice("Folder generation complete.");
}
