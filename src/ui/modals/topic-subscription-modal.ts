import { App, Modal, Setting, Notice } from "obsidian";
import { LibraryConfig } from "../../library/types";
import { Logger } from "../../utils/logger";
import { LibraryManager } from "../../library/git/library-manager";

export class TopicSubscriptionModal extends Modal {
    private selectedTopics: Set<string> = new Set();

    constructor(
        app: App,
        private libraryMetadata: LibraryConfig,
        private destinationPath: string,
        private libraryManager: LibraryManager,
        private onComplete?: () => void
    ) {
        super(app);
        // Default to subscribing to all topics? Or none?
        // Usually, users want something. Let's default to empty for strict sparse-checkout "genius".
        // Actually, let's pre-select all if they are installing for the first time.
        if (libraryMetadata.availableTopics) {
            libraryMetadata.availableTopics.forEach(t => this.selectedTopics.add(t));
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("af-topic-subscription-modal");

        contentEl.createEl("h2", { text: `Subscribe to ${this.libraryMetadata.name}` });
        contentEl.createEl("p", { 
            text: "Select the topics you want to sync. Only the selected topics will be downloaded to your vault.",
            cls: "af-modal-description"
        });

        const topicsContainer = contentEl.createDiv({ cls: "af-topics-checklist" });

        if (!this.libraryMetadata.availableTopics || this.libraryMetadata.availableTopics.length === 0) {
            topicsContainer.createEl("p", { text: "No topics defined in this library. Full library will be synced.", cls: "empty-text" });
        } else {
            this.libraryMetadata.availableTopics.forEach(topic => {
                const setting = new Setting(topicsContainer)
                    .setName(topic)
                    .addToggle(toggle => {
                        toggle.setValue(this.selectedTopics.has(topic))
                            .onChange(value => {
                                if (value) this.selectedTopics.add(topic);
                                else this.selectedTopics.delete(topic);
                            });
                    });
            });
        }

        const actionsEl = contentEl.createDiv({ cls: "af-modal-actions" });
        
        new Setting(actionsEl)
            .addButton(btn => btn
                .setButtonText("Cancel")
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText("Subscribe")
                .setCta()
                .onClick(() => this.handleSubscribe(btn.buttonEl)));
    }

    private async handleSubscribe(btnEl: HTMLButtonElement) {
        btnEl.disabled = true;
        btnEl.textContent = "Processing...";

        try {
            const config: LibraryConfig = {
                ...this.libraryMetadata,
                subscribedTopics: Array.from(this.selectedTopics)
            };

            new Notice(`Subscribing to ${config.name}...`);
            await this.libraryManager.subscribeToLibrary(this.destinationPath, config);
            
            new Notice("Subscription successful!");
            this.onComplete?.();
            this.close();
        } catch (error) {
            Logger.error("Failed to subscribe", error);
            new Notice(`Subscription failed: ${error.message}`);
            btnEl.disabled = false;
            btnEl.textContent = "Subscribe";
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
