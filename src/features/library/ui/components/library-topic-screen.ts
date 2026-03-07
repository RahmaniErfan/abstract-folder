import { App, setIcon, TFolder, TFile } from "obsidian";
import type AbstractFolderPlugin from "../../../../../main";
import { LibraryNode } from "../../types";
import { ContextEngine } from "../../../../core/context-engine";

export interface LibraryTopicScreenOptions {
    containerEl: HTMLElement;
    selectedLibrary: LibraryNode;
    onBack: () => void;
    onTopicSelect: (topic: string) => void;
}

export class LibraryTopicScreen {
    constructor(
        private app: App,
        private plugin: AbstractFolderPlugin,
        private contextEngine: ContextEngine,
        private options: LibraryTopicScreenOptions
    ) {}

    async render() {
        const { containerEl, selectedLibrary } = this.options;
        if (!selectedLibrary || !selectedLibrary.file) return;

        const header = containerEl.createDiv({ cls: "abstract-folder-header topic-screen-header" });
        const titleRow = header.createDiv({ cls: "abstract-folder-header-title-container" });
        
        const backBtn = titleRow.createDiv({ 
            cls: "af-header-back-button abstract-folder-toolbar-action clickable-icon", 
            attr: { "aria-label": "Back to Shelf" } 
        });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => {
            this.options.onBack();
        });

        const titleEl = titleRow.createEl("h3", { cls: "abstract-folder-header-title" });
        titleEl.createSpan({ text: selectedLibrary.file.name });
        titleEl.createSpan({ cls: "af-header-subtitle", text: " » Select a Topic" });

        const body = containerEl.createDiv({ cls: "library-topic-screen" });
        const grid = body.createDiv({ cls: "library-card-grid" });

        // 1. "All" Button
        const allCard = grid.createDiv({ cls: "library-explorer-card all-card" });
        const allInfo = allCard.createDiv({ cls: "library-card-info" });
        const allIcon = allInfo.createDiv({ cls: "library-card-icon" });
        setIcon(allIcon, "layers");
        
        const allText = allInfo.createDiv({ cls: "library-card-text-info" });
        allText.createDiv({ cls: "library-card-name", text: "All Topics" });
        allText.createDiv({ cls: "library-card-author", text: "View everything in this library." });
        
        allCard.addEventListener("click", () => {
            this.options.onTopicSelect('all');
        });

        // 2. Fetch Topics
        const libPath = selectedLibrary.file.path;
        console.log(`[LibraryTopicScreen] Loading config for: ${libPath}`);
        const config = await this.plugin.libraryManager.validateLibrary(libPath).catch((e) => {
            console.error(`[LibraryTopicScreen] validateLibrary failed for ${libPath}:`, e);
            return null;
        });
        
        const subscribed = config?.subscribedTopics || [];
        const available = config?.availableTopics || [];
        const topics = Array.from(new Set([...subscribed, ...available]));
        
        topics.forEach((topic: string) => {
            const topicCard = grid.createDiv({ cls: "library-explorer-card" });
            const topicInfo = topicCard.createDiv({ cls: "library-card-info" });
            const topicIcon = topicInfo.createDiv({ cls: "library-card-icon" });
            setIcon(topicIcon, "folder");
            
            const topicText = topicInfo.createDiv({ cls: "library-card-text-info" });
            topicText.createDiv({ cls: "library-card-name", text: topic });
            topicText.createDiv({ cls: "library-card-author", text: "Topic" });
            
            topicCard.addEventListener("click", () => {
                this.options.onTopicSelect(topic);
            });
        });

        if (topics.length === 0) {
            const emptyHint = body.createDiv({ cls: "topic-empty-hint" });
            emptyHint.createEl("p", { text: "No topics subscribed. You can manage subscriptions in Library Settings." });
        }
    }
}
