import { App, AbstractInputSuggest, setIcon } from "obsidian";
import { FolderIndexer } from "../indexer";
import { AbstractFolderPluginSettings } from "../settings";

export class PathSuggest extends AbstractInputSuggest<string> {
    private suggestionMetadata: Map<string, string> = new Map();

    constructor(
        app: App, 
        private inputEl: HTMLInputElement,
        private indexer: FolderIndexer,
        private settings: AbstractFolderPluginSettings
    ) {
        super(app, inputEl);
    }

    // @ts-ignore
    public get suggestContainerEl(): HTMLElement {
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const el = super.suggestContainerEl;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        el.addClass("abstract-folder-suggestion-container");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return el;
    }

    getSuggestions(inputStr: string): string[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        const suggestEl = (this as any).suggestEl as HTMLElement;
        
        if (suggestEl) {
            let container = suggestEl;
            // The actual positioned element is usually .suggestion-container which wraps .suggestion
            if (!container.hasClass("suggestion-container") && container.parentElement?.hasClass("suggestion-container")) {
                container = container.parentElement;
            }
            container.addClass("abstract-folder-suggestion-container");
        }

        const abstractFolderPaths: Set<string> = new Set();
        this.suggestionMetadata.clear();
        
        const files = this.app.vault.getAllLoadedFiles();
        const lowerCaseInputStr = inputStr.toLowerCase();

        // 1. Base Matches
        const matches: string[] = [];
        for (const file of files) {
            if (file.path.toLowerCase().includes(lowerCaseInputStr)) {
                matches.push(file.path);
                abstractFolderPaths.add(file.path);
                if (matches.length >= 20) break; // Soft limit for initial matches
            }
        }

        // 2. Add Context (Parents)
        if (this.settings.searchShowParents) {
            const graph = this.indexer.getGraph();
            for (const matchPath of matches) {
                const parents = graph.childToParents.get(matchPath);
                if (parents) {
                    parents.forEach(p => {
                        if (!abstractFolderPaths.has(p)) {
                             abstractFolderPaths.add(p);
                             this.suggestionMetadata.set(p, `Parent of ${matchPath.split('/').pop()}`);
                        }
                    });
                }
            }
        }

        // 3. Add Context (Children)
        if (this.settings.searchShowChildren) {
             const graph = this.indexer.getGraph();
             const parentToChildren = graph.parentToChildren;
             
             for (const matchPath of matches) {
                 // Check if the match is a key in parentToChildren (i.e. it is a parent)
                 const children = parentToChildren[matchPath];
                 if (children && children.size > 0) {
                     children.forEach(c => {
                         if (!abstractFolderPaths.has(c)) {
                             abstractFolderPaths.add(c);
                             this.suggestionMetadata.set(c, `Child of ${matchPath.split('/').pop()}`);
                         }
                     });
                 }
             }
        }

        // 92 | Return the final list as an array
        // Sorting: 
        // 1. Exact matches first
        // 2. Starts with query
        // 3. Includes query
        // 4. Parents/Children (Context)
        
        return Array.from(abstractFolderPaths).sort((a, b) => {
            const aLower = a.toLowerCase();
            const bLower = b.toLowerCase();
            const query = lowerCaseInputStr;

            // Check if items are context items (in metadata)
            const aIsContext = this.suggestionMetadata.has(a);
            const bIsContext = this.suggestionMetadata.has(b);

            // Prioritize direct matches over context items
            if (aIsContext && !bIsContext) return 1;
            if (!aIsContext && bIsContext) return -1;

            // If both are direct matches (or both context), apply standard ranking
            
            // 1. Exact match
            if (aLower === query && bLower !== query) return -1;
            if (bLower === query && aLower !== query) return 1;

            // 2. Starts with query
            const aStarts = aLower.startsWith(query);
            const bStarts = bLower.startsWith(query);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;

            // 3. Shortest path (usually more relevant)
            if (a.length !== b.length) return a.length - b.length;

            // 4. Alphabetical
            return a.localeCompare(b);
        });
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        const text = value;
        const suggestionEl = el.createDiv({ cls: "abstract-folder-suggestion-item" });
        
        const mainText = suggestionEl.createDiv({ cls: "suggestion-content" });
        mainText.setText(text);

        const metadata = this.suggestionMetadata.get(value);
        if (metadata) {
            const aux = suggestionEl.createDiv({ cls: "suggestion-aux" });
            const iconSpan = aux.createSpan({ cls: "suggestion-icon" });
            setIcon(iconSpan, metadata.startsWith("Parent") ? "arrow-up-left" : "arrow-down-right");
            aux.createSpan({ text: metadata, cls: "suggestion-note" });
        }
    }

    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        this.inputEl.value = value;
        this.inputEl.trigger("input");
        this.close();
    }
}
