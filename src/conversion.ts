import { App, TFolder, TFile, Notice } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";
import { FolderIndexer } from "./indexer";

export interface ConversionOptions {
    createParentNotes: boolean;
    existingRelationshipsStrategy: 'append' | 'replace';
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

    const processFolder = async (folder: TFolder) => {
        // Find or create the parent note for this folder
        let parentNote: TFile | null = null;
        
        // Strategy: Look for "Folder A.md" in the parent directory of "Folder A".
        const parentOfFolder = folder.parent;
        const potentialParentNotePath = parentOfFolder
            ? `${parentOfFolder.path === '/' ? '' : parentOfFolder.path + '/'}${folder.name}.md`
            : `${folder.name}.md`;
        
        parentNote = app.vault.getAbstractFileByPath(potentialParentNotePath) as TFile;

        // Special case: if we are processing the root folder selected by user, we might be creating a note for IT,
        // or just scanning its children.
        // If the user selected "MyProject" folder, files inside "MyProject" should have "MyProject.md" as parent.
        
        if (!parentNote && options.createParentNotes) {
             try {
                // Create it if it doesn't exist
                parentNote = await app.vault.create(potentialParentNotePath, "");
            } catch (e) {
                console.warn(`Could not create parent note at ${potentialParentNotePath}`, e);
            }
        }

        if (parentNote) {
            // Now link all children of this folder to this parent note
            for (const child of folder.children) {
                if (child instanceof TFile && child.path !== parentNote.path) {
                    // Avoid self-linking or linking the parent note to itself if it somehow ended up inside
                    if (child.path === potentialParentNotePath) continue;

                    await linkChildToParent(app, settings, child, parentNote, options.existingRelationshipsStrategy);
                    updatedCount++;
                } else if (child instanceof TFolder) {
                    // Recurse
                    await processFolder(child);
                }
            }
        } else {
            // Recurse even if current folder has no parent note
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    await processFolder(child);
                }
            }
        }
    };

    await processFolder(rootFolder);
    new Notice(`Conversion complete. Updated ${updatedCount} relationships.`);
    app.workspace.trigger('abstract-folder:graph-updated');
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

    // 2. Update PARENT to point to CHILD (childrenPropertyName)
    await app.fileManager.processFrontMatter(parent, (frontmatter) => {
        const childrenPropertyName = settings.childrenPropertyName || "children";
        let currentChildren = frontmatter[childrenPropertyName] || [];

        if (typeof currentChildren === 'string') {
            currentChildren = [currentChildren];
        } else if (!Array.isArray(currentChildren)) {
             if (currentChildren) currentChildren = [String(currentChildren)];
             else currentChildren = [];
        }

        const childLink = `[[${child.basename}]]`;

        if (!currentChildren.includes(childLink)) {
            currentChildren.push(childLink);
        }
        frontmatter[childrenPropertyName] = currentChildren;
    });
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
            
            for (const child of children) {
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
