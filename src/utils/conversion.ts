import { App, TFolder, TFile, TAbstractFile, Notice, normalizePath } from "obsidian";
import { AbstractFolderPluginSettings } from "../settings";
import { FolderIndexer } from "../indexer";
import { AbstractFolderFrontmatter } from "../types";

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
    resolution?: string; // 'duplicate' or the specific target path to use
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
    // Signal start immediately to lock the UI
    app.workspace.trigger('abstract-folder:conversion-start', { total: 0, message: "Preparing conversion..." });
    
    // Yield to let the UI update to the 'Converting' state and prevent flickering
    await new Promise(resolve => setTimeout(resolve, 0));

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
    // Queue for batch processing
    const operations: (() => Promise<void>)[] = [];

    for (const folder of allFoldersInScope) {
        if (folder === rootFolder && rootFolder.parent === null) { // Handle vault root case
            // If the rootFolder is the actual vault root, don't try to create a parent note for it based on a parent folder.
            // Files directly in the vault root won't have a conceptual parent from the folder structure.
            continue;
        }

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

        const file = app.vault.getAbstractFileByPath(potentialParentNotePath);
        let folderNote = file instanceof TFile ? file : null;

        if (!folderNote && options.createParentNotes) {
            try {
                folderNote = await app.vault.create(potentialParentNotePath, "");
                updatedCount++;
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
                        operations.push(async () => {
                            await linkChildToParent(app, settings, child, folderNote, options.existingRelationshipsStrategy);
                        });
                        updatedCount++;
                    } else if (child.path !== folderNote.path) {
                        // Non-markdown file: only add to parent note's children, not vice-versa
                        operations.push(async () => {
                            await addChildToParentNoteFrontmatter(app, settings, child, folderNote);
                        });
                        updatedCount++;
                    }
                }
            }
        }
    }
    
    // Execute Pass 1 Operations
    const pass1Total = operations.length;
    app.workspace.trigger('abstract-folder:conversion-start', { total: pass1Total, message: "Phase 1/2: Linking files..." });
    
    let lastReportedTime = 0;
    const REPORT_INTERVAL = 100; // Throttle UI updates to every 100ms

    await processInBatches(operations, 50, (completed: number, total: number) => {
        const now = Date.now();
        if (now - lastReportedTime > REPORT_INTERVAL || completed === total) {
             app.workspace.trigger('abstract-folder:conversion-progress', { 
                processed: completed, 
                total: pass1Total, 
                message: `Phase 1/2: Linking files... (${completed}/${pass1Total})` 
            });
            lastReportedTime = now;
        }
    });
    
    operations.length = 0; // Clear queue

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
        const file = app.vault.getAbstractFileByPath(currentFolderNotePath);
        const currentFolderNote = file instanceof TFile ? file : null;

        if (!currentFolderNote) {
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
        const parentFile = app.vault.getAbstractFileByPath(parentFolderNotePath);
        const parentFolderNote = parentFile instanceof TFile ? parentFile : null;

        if (parentFolderNote && currentFolderNote.path !== parentFolderNote.path) {
            operations.push(async () => {
                await linkChildToParent(app, settings, currentFolderNote, parentFolderNote, options.existingRelationshipsStrategy);
            });
            updatedCount++;
        } else {
            // No parent folder note or self-link, no linking needed.
        }
    }

    // Execute Pass 2 Operations
    const pass2Total = operations.length;
    app.workspace.trigger('abstract-folder:conversion-progress', { 
        processed: 0, 
        total: pass2Total, 
        message: "Phase 2/2: Structuring hierarchy..." 
    });

    lastReportedTime = 0; // Reset for phase 2

    await processInBatches(operations, 50, (completed: number, total: number) => {
         const now = Date.now();
         if (now - lastReportedTime > REPORT_INTERVAL || completed === total) {
             app.workspace.trigger('abstract-folder:conversion-progress', { 
                processed: completed, 
                total: pass2Total, 
                message: `Phase 2/2: Structuring hierarchy... (${completed}/${pass2Total})` 
            });
            lastReportedTime = now;
         }
    });

    // Wait for a short period to allow the indexer to process pending metadata cache updates.
    // The Indexer listens to metadataCache.on('changed'), which happens asynchronously after processFrontMatter.
    // By waiting here, we give the indexer a chance to update its graph BEFORE we unlock the UI.
    // This reduces the visual "flickering" or "files jumping" effect.
    app.workspace.trigger('abstract-folder:conversion-progress', { 
        processed: pass2Total, 
        total: pass2Total, 
        message: "Finalizing... (Waiting for indexer)" 
    });
    
    // Wait for 2 seconds to allow debounce and event processing to catch up
    await new Promise(resolve => setTimeout(resolve, 2000));

    new Notice(`Conversion complete. Updated ${updatedCount} relationships.`);
    app.workspace.trigger('abstract-folder:conversion-complete');
    app.workspace.trigger('abstract-folder:graph-updated');
}

async function addChildToParentNoteFrontmatter(
    app: App,
    settings: AbstractFolderPluginSettings,
    childFile: TAbstractFile, // Can be TFile or TFolder
    parentNote: TFile
) {
    await app.fileManager.processFrontMatter(parentNote, (frontmatter: AbstractFolderFrontmatter) => {
        const childrenPropertyName = settings.childrenPropertyName || "children";
        const rawChildren = frontmatter[childrenPropertyName];
        let currentChildren: string[] = [];

        if (typeof rawChildren === 'string') {
            currentChildren = [rawChildren];
        } else if (Array.isArray(rawChildren)) {
            currentChildren = rawChildren as string[];
        } else if (typeof rawChildren === 'number' || typeof rawChildren === 'boolean') {
             currentChildren = [String(rawChildren)];
        }

        // Use the basename for the link, regardless of file type
        const childLink = `[[${childFile.name}]]`; // Use 'name' property which is common to TFile and TFolder

        if (!currentChildren.includes(childLink)) {
            currentChildren.push(childLink);
        }

        // Dirty Check
        if (JSON.stringify(frontmatter[childrenPropertyName]) !== JSON.stringify(currentChildren)) {
             frontmatter[childrenPropertyName] = currentChildren;
        }
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
    await app.fileManager.processFrontMatter(child, (frontmatter: AbstractFolderFrontmatter) => {
        const parentPropertyName = settings.propertyName || "parent";
        const rawParents = frontmatter[parentPropertyName];
        let currentParents: string[] = [];

        // Normalize to array
        if (typeof rawParents === 'string') {
            currentParents = [rawParents];
        } else if (Array.isArray(rawParents)) {
             currentParents = rawParents as string[];
        } else if (typeof rawParents === 'number' || typeof rawParents === 'boolean') {
             currentParents = [String(rawParents)];
        }

        const parentLink = `[[${parent.basename}]]`;

        if (strategy === 'replace') {
            currentParents = [parentLink];
        } else {
             if (!currentParents.includes(parentLink)) {
                currentParents.push(parentLink);
            }
        }
        
        // Dirty Check
        if (JSON.stringify(frontmatter[parentPropertyName]) !== JSON.stringify(currentParents)) {
            frontmatter[parentPropertyName] = currentParents;
        }
    });

}

async function processInBatches(
    operations: (() => Promise<void>)[], 
    batchSize: number,
    onProgress?: (completed: number, total: number) => void
) {
    const total = operations.length;
    let completed = 0;

    for (let i = 0; i < operations.length; i += batchSize) {
        const batch = operations.slice(i, i + batchSize);
        await Promise.all(batch.map(op => op()));
        
        completed += batch.length;
        if (onProgress) {
            onProgress(Math.min(completed, total), total);
        }

        // Yield to main thread to allow UI updates
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}
/**
 * Generates a physical folder structure from the plugin's abstract folder format.
 * This function prepares the operations but does not execute them until confirmed.
 */
export function generateFolderStructurePlan(
    app: App,
    settings: AbstractFolderPluginSettings,
    indexer: FolderIndexer,
    destinationPath: string,
    placeIndexFileInside: boolean,
    rootScope?: TFile
): { fileTree: Map<string, string[]>, conflicts: FileConflict[] } {
    const normalizedDestinationPath = normalizePath(destinationPath);
    const fileTree = new Map<string, string[]>(); // FolderPath -> List of FilePaths to move/copy there
    const conflicts: FileConflict[] = [];
    const fileDestinations = new Map<string, string[]>(); // FilePath -> List of target folder paths

    // 1. Get the graph from the indexer
    const graph = indexer.getGraph();
    const parentToChildrenMap = graph.parentToChildren;

    const getChildren = (file: TFile): Set<TFile> => {
        const childrenFiles = new Set<TFile>();
        const childPaths = parentToChildrenMap[file.path];
        
        if (childPaths) {
            childPaths.forEach((path: string) => {
                const childFile = app.vault.getAbstractFileByPath(path);
                if (childFile instanceof TFile) {
                    childrenFiles.add(childFile);
                }
            });
        }
        return childrenFiles;
    };

    const processNode = (file: TFile, currentPath: string, visited: Set<string>) => {
        if (visited.has(file.path)) return;
        visited.add(file.path);

        const children = getChildren(file);
        
        if (children && children.size > 0) {
            const newFolderPath = `${currentPath}/${file.basename}`;
            
            if (placeIndexFileInside) {
                if (!fileDestinations.has(file.path)) fileDestinations.set(file.path, []);
                
                const targets = fileDestinations.get(file.path)!;
                const outsideIndex = targets.indexOf(currentPath);
                if (outsideIndex > -1) {
                    targets.splice(outsideIndex, 1);
                }
                
                targets.push(newFolderPath);
            } else {
                 const targets = fileDestinations.get(file.path);
                 if (targets) {
                     const outsideIndex = targets.indexOf(currentPath);
                     if (outsideIndex > -1) {
                         targets.splice(outsideIndex, 1);
                     }
                 }
            }

            for (const child of children) {
                if (child.path === file.path) continue;

                if (!fileDestinations.has(child.path)) fileDestinations.set(child.path, []);
                fileDestinations.get(child.path)!.push(newFolderPath);

                processNode(child, newFolderPath, new Set(visited));
            }
        }
    };

    if (rootScope) {
        // Handle the rootScope file itself: put it in normalizedDestinationPath
        if (!fileDestinations.has(rootScope.path)) fileDestinations.set(rootScope.path, []);
        fileDestinations.get(rootScope.path)!.push(normalizedDestinationPath);

        // Process children
        processNode(rootScope, normalizedDestinationPath, new Set());
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
                 children.forEach((c: string) => allChildren.add(c));
             }
        }

        // Roots are parents that are NOT children of anyone
        const roots = allParents.filter(p => !allChildren.has(p));
        

        for (const rootPath of roots) {
            const rootFile = app.vault.getAbstractFileByPath(rootPath);
            if (rootFile instanceof TFile) {
                // Ensure the root file itself is moved to the destination
                if (!fileDestinations.has(rootFile.path)) fileDestinations.set(rootFile.path, []);
                fileDestinations.get(rootFile.path)!.push(normalizedDestinationPath);

                processNode(rootFile, normalizedDestinationPath, new Set());
            }
        }
    }
    
    // 3. Identify conflicts
    for (const [filePath, targetFolders] of fileDestinations.entries()) {
        const abstractFile = app.vault.getAbstractFileByPath(filePath);
        if (!(abstractFile instanceof TFile)) continue;
        const file = abstractFile;
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
    
    // Resolve conflicts map for easy lookup
    const conflictMap = new Map<string, FileConflict>();
    conflicts.forEach(c => conflictMap.set(c.file.path, c));

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
                } catch (error) {
                     const check = app.vault.getAbstractFileByPath(currentPath);
                     if (!check) {
                         console.error(`[Abstract Folder] Failed to create folder ${currentPath}:`, error);
                     }
                }
            }
        }
    };

    for (const [folderPath, filePaths] of fileTree.entries()) {
        
        await createFolderRecursively(folderPath);

        for (const filePath of filePaths) {
            const file = app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const conflict = conflictMap.get(filePath);
                let action = 'copy';
                
                if (conflict) {
                    if (conflict.resolution === 'duplicate') {
                        action = 'copy';
                    } else if (conflict.resolution === folderPath) {
                        action = 'move';
                    } else {
                        continue;
                    }
                } else {
                    action = 'copy';
                }

                const newFilePath = `${folderPath}/${file.name}`;
                if (action === 'copy') {
                     await app.vault.copy(file, newFilePath);
                } else {
                    await app.fileManager.renameFile(file, newFilePath);
                }
            }
        }
    }
    
    new Notice("Folder generation complete.");
}
