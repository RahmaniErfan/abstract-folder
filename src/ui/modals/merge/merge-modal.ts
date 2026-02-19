import { Modal, App, Setting, ButtonComponent } from "obsidian";
import { MergeController, MergeState } from "./merge-controller";

export class MergeModal extends Modal {
    private controller: MergeController;
    private sidebarEl: HTMLElement;
    private editorEl: HTMLElement;

    constructor(app: App, private dir: string, private conflictedPaths: string[], private onComplete: () => Promise<void>) {
        super(app);
        this.controller = new MergeController((state) => this.render(state));
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.addClass("abstract-folder-merge-modal");
        
        contentEl.createEl("h2", { text: "Resolve Merge Conflicts" });

        const toolbar = contentEl.createDiv({ cls: "merge-bulk-toolbar" });
        new ButtonComponent(toolbar)
            .setButtonText("Keep All Local (Ours)")
            .onClick(() => {
                if (confirm("Are you sure you want to resolve ALL conflicts using your local versions?")) {
                    this.controller.resolveAllOurs();
                }
            });
            
        new ButtonComponent(toolbar)
            .setButtonText("Accept All Incoming (Theirs)")
            .onClick(() => {
                if (confirm("Are you sure you want to resolve ALL conflicts using the remote versions?")) {
                    this.controller.resolveAllTheirs();
                }
            });

        const mainContainer = contentEl.createDiv({ cls: "merge-main-container" });
        this.sidebarEl = mainContainer.createDiv({ cls: "merge-sidebar" });
        this.editorEl = mainContainer.createDiv({ cls: "merge-editor-container" });

        const footer = contentEl.createDiv({ cls: "merge-footer" });
        new ButtonComponent(footer)
            .setButtonText("Cancel")
            .onClick(() => this.close());

        this.initController();
    }

    private async initController() {
        await this.controller.init(this.dir, this.conflictedPaths);
    }

    private render(state: MergeState) {
        this.renderSidebar(state);
        this.renderEditor(state);
        this.renderFooter(state);
    }

    private renderSidebar(state: MergeState) {
        this.sidebarEl.empty();
        state.conflicts.forEach((conflict, index) => {
            const item = this.sidebarEl.createDiv({ 
                cls: `merge-sidebar-item ${index === state.currentIndex ? 'is-active' : ''}` 
            });
            const status = state.resolutions.has(conflict.path) ? "✅" : "🔴";
            item.createSpan({ text: `${status} ${conflict.path}` });
            item.onClickEvent(() => this.controller.selectConflict(index));
        });
    }

    private renderEditor(state: MergeState) {
        const conflict = this.controller.getCurrentConflict();
        this.editorEl.empty();
        
        if (!conflict) {
            this.editorEl.createEl("p", { text: "All conflicts resolved or no file selected." });
            return;
        }

        // Placeholder for the actual CodeMirror Merge Editor
        this.editorEl.createEl("h3", { text: `Conflict in: ${conflict.path}` });
        
        const editorActions = this.editorEl.createDiv({ cls: "merge-editor-actions" });
        new ButtonComponent(editorActions)
            .setButtonText("Accept Current (Local)")
            .onClick(() => this.controller.resolveCurrent(conflict.currentContent));
            
        new ButtonComponent(editorActions)
            .setButtonText("Accept Incoming (Remote)")
            .onClick(() => this.controller.resolveCurrent(conflict.incomingContent));

        // In the final version, this is where the @codemirror/merge view will go
        const diffDisplay = this.editorEl.createDiv({ cls: "merge-diff-display" });
        const localCol = diffDisplay.createDiv({ cls: "diff-col" });
        localCol.createEl("strong", { text: "Local" });
        localCol.createEl("pre", { text: conflict.currentContent });

        const remoteCol = diffDisplay.createDiv({ cls: "diff-col" });
        remoteCol.createEl("strong", { text: "Remote" });
        remoteCol.createEl("pre", { text: conflict.incomingContent });
    }

    private renderFooter(state: MergeState) {
        let footer = this.contentEl.querySelector(".merge-footer");
        if (!footer) return;
        
        const finalizeBtnContainer = footer.querySelector(".finalize-btn-container") || footer.createDiv({ cls: "finalize-btn-container" });
        finalizeBtnContainer.empty();

        new ButtonComponent(finalizeBtnContainer as HTMLElement)
            .setButtonText("Finalize & Merge")
            .setCta()
            .setDisabled(!state.isComplete)
            .onClick(async () => {
                try {
                    await this.controller.finalize(this.dir);
                    this.close();
                    await this.onComplete();
                } catch (e) {
                    console.error("Failed to finalize merge:", e);
                }
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
