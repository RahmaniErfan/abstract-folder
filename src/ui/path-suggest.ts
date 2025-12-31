import { App, AbstractInputSuggest } from "obsidian";

export class PathSuggest extends AbstractInputSuggest<string> {
    constructor(app: App, private inputEl: HTMLInputElement) {
        super(app, inputEl);
    }
    
    // @ts-ignore
    public get suggestContainerEl(): HTMLElement {
        // @ts-ignore
        const el = super.suggestContainerEl;
        el.addClass("abstract-folder-suggestion-container");
        return el;
    }

    getSuggestions(inputStr: string): string[] {
        // @ts-ignore
        const suggestEl = this.suggestEl as HTMLElement;
        
        // Attempt to find the outer container that has the positioning
        if (suggestEl) {
            let container = suggestEl;
            // The actual positioned element is usually .suggestion-container which wraps .suggestion
            // We traverse up just in case suggestEl is the inner list
            if (!container.hasClass("suggestion-container") && container.parentElement?.hasClass("suggestion-container")) {
                container = container.parentElement;
            }
            container.addClass("abstract-folder-suggestion-container");
        }

        const abstractFolderPaths: string[] = []; // In a real plugin, you might get these from your indexer
        // For now, let's suggest all files and folders in the vault
        const files = this.app.vault.getAllLoadedFiles();
        for (const file of files) {
            abstractFolderPaths.push(file.path);
        }

        const lowerCaseInputStr = inputStr.toLowerCase();
        return abstractFolderPaths.filter(path =>
            path.toLowerCase().includes(lowerCaseInputStr)
        );
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }

    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        this.inputEl.value = value;
        this.inputEl.trigger("input");
        this.close();
    }
}