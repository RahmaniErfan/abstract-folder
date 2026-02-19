import { ConflictInfo, ConflictManager } from "../../../library/git/conflict-manager";

export interface MergeState {
    conflicts: ConflictInfo[];
    currentIndex: number;
    resolutions: Map<string, string>;
    isComplete: boolean;
}

export class MergeController {
    private state: MergeState = {
        conflicts: [],
        currentIndex: 0,
        resolutions: new Map(),
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
            }
        }

        this.state.conflicts = conflicts;
        this.notify();
    }

    getCurrentConflict(): ConflictInfo | null {
        return this.state.conflicts[this.state.currentIndex] || null;
    }

    selectConflict(index: number) {
        if (index >= 0 && index < this.state.conflicts.length) {
            this.state.currentIndex = index;
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
