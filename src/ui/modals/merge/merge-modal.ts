import { Modal, App, Setting, ButtonComponent } from "obsidian";
import { MergeController, MergeState } from "./merge-controller";
import { diffLines } from "../../../utils/diff";

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

        // Header and Toolbar
        const header = this.editorEl.createDiv({ cls: "merge-editor-header" });
        header.createEl("h3", { text: `Conflict in: ${conflict.path}` });
        
        const editorActions = header.createDiv({ cls: "merge-editor-actions" });
        
        // Navigation arrows
        const navGroup = editorActions.createDiv({ cls: "merge-nav-group" });
        new ButtonComponent(navGroup)
            .setIcon("up-chevron-glyph")
            .setTooltip("Previous Conflict")
            .onClick(() => this.scrollToConflict('prev'));
        new ButtonComponent(navGroup)
            .setIcon("down-chevron-glyph")
            .setTooltip("Next Conflict")
            .onClick(() => this.scrollToConflict('next'));

        new ButtonComponent(editorActions)
            .setButtonText("Accept All Local")
            .onClick(() => this.controller.resolveCurrent(conflict.currentContent));
            
        new ButtonComponent(editorActions)
            .setButtonText("Accept All Incoming")
            .onClick(() => this.controller.resolveCurrent(conflict.incomingContent));

        const blocks = this.controller.getCurrentBlocks();
        const blockResolutions = this.controller.getCurrentBlockResolutions();

        // 3-Pane Layout Container
        const panesContainer = this.editorEl.createDiv({ cls: "merge-panes-container" });

        // Top Half: Diff Display
        const diffDisplay = panesContainer.createDiv({ cls: "merge-diff-display" });
        const localCol = diffDisplay.createDiv({ cls: "diff-col local-col" });
        localCol.createEl("strong", { text: "Local" });
        const localContent = localCol.createDiv({ cls: "diff-content" });

        const remoteCol = diffDisplay.createDiv({ cls: "diff-col remote-col" });
        remoteCol.createEl("strong", { text: "Remote" });
        const remoteContent = remoteCol.createDiv({ cls: "diff-content" });

        blocks.forEach((block, blockIndex) => {
            if (block.type === 'unchanged') {
                block.localLines.forEach((line, i) => {
                    this.renderLine(localContent, line, block.localStartLine + i);
                    this.renderLine(remoteContent, line, block.remoteStartLine + i);
                });
            } else {
                const isResolved = blockResolutions.has(blockIndex);
                const resolution = blockResolutions.get(blockIndex);
                const isLocalResolved = isResolved && resolution === block.localLines.join('\n');
                const isRemoteResolved = isResolved && resolution === block.remoteLines.join('\n');

                const localActions = localContent.createDiv({ cls: "diff-block-actions conflict-marker" });
                localActions.dataset.blockIndex = blockIndex.toString();
                if (!isResolved || !isLocalResolved) {
                    new ButtonComponent(localActions)
                        .setButtonText("Accept Local")
                        .setClass("inline-action-btn")
                        .onClick(() => this.controller.resolveBlock(blockIndex, block.localLines.join('\n')));
                } else if (isLocalResolved) {
                    localActions.createSpan({ text: "Resolved (Local)", cls: "resolved-badge" });
                    new ButtonComponent(localActions)
                        .setButtonText("Undo")
                        .setClass("inline-action-btn")
                        .onClick(() => this.controller.resolveBlock(blockIndex, null));
                }

                const remoteActions = remoteContent.createDiv({ cls: "diff-block-actions conflict-marker" });
                remoteActions.dataset.blockIndex = blockIndex.toString();
                if (!isResolved || !isRemoteResolved) {
                    new ButtonComponent(remoteActions)
                        .setButtonText("Accept Remote")
                        .setClass("inline-action-btn")
                        .onClick(() => this.controller.resolveBlock(blockIndex, block.remoteLines.join('\n')));
                } else if (isRemoteResolved) {
                    remoteActions.createSpan({ text: "Resolved (Remote)", cls: "resolved-badge" });
                    new ButtonComponent(remoteActions)
                        .setButtonText("Undo")
                        .setClass("inline-action-btn")
                        .onClick(() => this.controller.resolveBlock(blockIndex, null));
                }

                const maxLines = Math.max(block.localLines.length, block.remoteLines.length);
                for (let i = 0; i < maxLines; i++) {
                    if (i < block.localLines.length) {
                        this.renderLine(localContent, block.localLines[i], block.localStartLine + i, 'is-removed');
                    } else {
                        this.renderEmptyLine(localContent);
                    }

                    if (i < block.remoteLines.length) {
                        this.renderLine(remoteContent, block.remoteLines[i], block.remoteStartLine + i, 'is-added');
                    } else {
                        this.renderEmptyLine(remoteContent);
                    }
                }
            }
        });

        // Bottom Half: Result Preview
        const previewContainer = panesContainer.createDiv({ cls: "merge-preview-container" });
        previewContainer.createEl("h4", { text: "Result Preview" });
        const resultText = this.controller.getResultContent(conflict.path);
        previewContainer.createEl("pre", { text: resultText });
    }

    private scrollToConflict(direction: 'next' | 'prev') {
        const diffDisplay = this.editorEl.querySelector('.merge-diff-display');
        if (!diffDisplay) return;

        const markers = Array.from(diffDisplay.querySelectorAll('.conflict-marker')) as HTMLElement[];
        if (markers.length === 0) return;

        // Find current scroll position
        const currentScroll = diffDisplay.scrollTop;
        
        let targetMarker: HTMLElement | null = null;
        
        if (direction === 'next') {
            targetMarker = markers.find(m => m.offsetTop > currentScroll + 50) || markers[0];
        } else {
            targetMarker = [...markers].reverse().find(m => m.offsetTop < currentScroll - 50) || markers[markers.length - 1];
        }

        if (targetMarker) {
            targetMarker.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    private renderLine(container: HTMLElement, text: string, lineNum: number, cls?: string) {
        const lineEl = container.createDiv({ cls: `diff-line ${cls || ''}` });
        lineEl.createSpan({ cls: "diff-line-number", text: lineNum.toString() });
        lineEl.createEl("pre", { text: text || " " });
    }

    private renderEmptyLine(container: HTMLElement) {
        const lineEl = container.createDiv({ cls: `diff-line is-empty` });
        lineEl.createSpan({ cls: "diff-line-number", text: " " });
        lineEl.createEl("pre", { text: " " });
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
