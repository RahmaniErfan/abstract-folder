import { App, TFile, TFolder, AbstractInputSuggest } from "obsidian";

export class PathSuggest extends AbstractInputSuggest<string> {
    constructor(app: App, private inputEl: HTMLInputElement) {
        super(app, inputEl);
    }

    getSuggestions(inputStr: string): string[] {
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