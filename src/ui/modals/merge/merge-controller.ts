import { ConflictInfo, ConflictManager } from "../../../library/git/conflict-manager";
import { DiffBlock, diffLines } from "../../../utils/diff";

export interface MergeState {
    conflicts: ConflictInfo[];
    currentIndex: number;
    resolutions: Map<string, string>; // Full file resolutions
    blockResolutions: Map<string, Map<number, string>>; // Block-by-block resolutions for each file
    fileBlocks: Map<string, DiffBlock[]>; // Computed blocks for each file
    isComplete: boolean;
}

export class MergeController {
    private state: MergeState = {
        conflicts: [],
        currentIndex: 0,
        resolutions: new Map(),
        blockResolutions: new Map(),
        fileBlocks: new Map(),
        isComplete: false
    };

    private onStateChange: (state: MergeState) => void;

    constructor(onStateChange: (state: MergeState) => void) {
        this.onStateChange = onStateChange;
    }

    async init(dir: string, conflictedPaths: string[]) {
        const conflicts: ConflictInfo[] = [];
        
        for (const path of conflictedPaths) {
            const info = await ConflictManager.getConflictInfo(dir, path);
            if (info) {
                conflicts.push(info);
                // Pre-compute diff blocks
                const blocks = diffLines(info.currentContent, info.incomingContent);
                this.state.fileBlocks.set(path, blocks);
                this.state.blockResolutions.set(path, new Map());
            }
        }

        this.state.conflicts = conflicts;
        this.notify();
    }

    getCurrentConflict(): ConflictInfo | null {
        return this.state.conflicts[this.state.currentIndex] || null;
    }
    
    getCurrentBlocks(): DiffBlock[] {
        const current = this.getCurrentConflict();
        return current ? (this.state.fileBlocks.get(current.path) || []) : [];
    }
    
    getCurrentBlockResolutions(): Map<number, string> {
        const current = this.getCurrentConflict();
        return current ? (this.state.blockResolutions.get(current.path) || new Map()) : new Map();
    }

    selectConflict(index: number) {
        if (index >= 0 && index < this.state.conflicts.length) {
            this.state.currentIndex = index;
            this.notify();
        }
    }

    resolveBlock(blockIndex: number, content: string | null) {
        const current = this.getCurrentConflict();
        if (current) {
            const blockRes = this.state.blockResolutions.get(current.path)!;
            if (content === null) {
                blockRes.delete(blockIndex);
            } else {
                blockRes.set(blockIndex, content);
            }
            
            // Check if all conflict blocks are resolved
            const blocks = this.state.fileBlocks.get(current.path)!;
            const conflictBlocksCount = blocks.filter(b => b.type === 'conflict').length;
            if (blockRes.size === conflictBlocksCount) {
                // Auto-resolve current file
                this.resolveCurrentFromBlocks();
            } else {
                // Remove from resolutions if it was previously auto-resolved
                this.state.resolutions.delete(current.path);
                this.checkCompletion();
                this.notify();
            }
        }
    }

    getResultContent(path: string): string {
        const blocks = this.state.fileBlocks.get(path);
        if (!blocks) return "";
        const blockRes = this.state.blockResolutions.get(path) || new Map();
        
        let finalContent = "";
        for (let i = 0; i < blocks.length; i++) {
            if (blocks[i].type === 'unchanged') {
                finalContent += blocks[i].localLines.join('\n') + (blocks[i].localLines.length > 0 ? '\n' : '');
            } else {
                const res = blockRes.get(i);
                if (res !== undefined) {
                    finalContent += res + (res ? '\n' : '');
                } else {
                    // Unresolved block - show conflict markers
                    finalContent += "<<<<<<< Local\n";
                    finalContent += blocks[i].localLines.join('\n') + (blocks[i].localLines.length > 0 ? '\n' : '');
                    finalContent += "=======\n";
                    finalContent += blocks[i].remoteLines.join('\n') + (blocks[i].remoteLines.length > 0 ? '\n' : '');
                    finalContent += ">>>>>>> Remote\n";
                }
            }
        }
        
        return finalContent;
    }

    private resolveCurrentFromBlocks() {
        const current = this.getCurrentConflict();
        if (current) {
            const blocks = this.state.fileBlocks.get(current.path)!;
            const blockRes = this.state.blockResolutions.get(current.path)!;
            
            let finalContent = "";
            for (let i = 0; i < blocks.length; i++) {
                if (blocks[i].type === 'unchanged') {
                    finalContent += blocks[i].localLines.join('\n') + (blocks[i].localLines.length > 0 ? '\n' : '');
                } else {
                    const res = blockRes.get(i);
                    if (res !== undefined) {
                        finalContent += res + (res ? '\n' : '');
                    }
                }
            }
            
            // Remove trailing newline if it wasn't in the original?
            if (finalContent.endsWith('\n') && !current.currentContent.endsWith('\n') && !current.incomingContent.endsWith('\n')) {
                 finalContent = finalContent.slice(0, -1);
            }
            
            this.state.resolutions.set(current.path, finalContent);
            this.checkCompletion();
            this.notify();
        }
    }

    resolveCurrent(content: string) {
        const current = this.getCurrentConflict();
        if (current) {
            this.state.resolutions.set(current.path, content);
            this.checkCompletion();
            this.notify();
        }
    }

    resolveAllOurs() {
        this.state.conflicts.forEach(c => {
            this.state.resolutions.set(c.path, c.currentContent);
        });
        this.checkCompletion();
        this.notify();
    }

    resolveAllTheirs() {
        this.state.conflicts.forEach(c => {
            this.state.resolutions.set(c.path, c.incomingContent);
        });
        this.checkCompletion();
        this.notify();
    }

    private checkCompletion() {
        this.state.isComplete = this.state.conflicts.every(c => this.state.resolutions.has(c.path));
    }

    async finalize(dir: string) {
        if (!this.state.isComplete) throw new Error("Not all conflicts are resolved.");

        for (const [path, content] of this.state.resolutions.entries()) {
            await ConflictManager.resolveConflict(dir, path, content);
        }
    }

    private notify() {
        this.onStateChange({ ...this.state });
    }

    getState(): MergeState {
        return { ...this.state };
    }
}
