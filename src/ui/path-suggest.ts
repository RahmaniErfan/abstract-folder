import {
	App,
	AbstractInputSuggest,
	setIcon,
	prepareFuzzySearch,
	SearchResult,
} from "obsidian";
import { FolderIndexer } from "../indexer";
import { AbstractFolderPluginSettings } from "../settings";

export class PathSuggest extends AbstractInputSuggest<string> {
	private suggestionMetadata: Map<string, string> = new Map();
	private searchScores: Map<string, number> = new Map();

	constructor(
		app: App,
		private inputEl: HTMLInputElement,
		private indexer: FolderIndexer,
		private settings: AbstractFolderPluginSettings
	) {
		super(app, inputEl);
	}

	// @ts-ignore - suggestContainerEl exists at runtime but not in base types
	public get suggestContainerEl(): HTMLElement {
		// @ts-ignore - accessing protected/private property
		const el = super.suggestContainerEl as HTMLElement;
		el.addClass("abstract-folder-suggestion-container");
		return el;
	}

	getSuggestions(inputStr: string): string[] {
		if (!inputStr || inputStr.trim().length === 0) {
			return [];
		}

		const suggestEl = (this as unknown as { suggestEl: HTMLElement }).suggestEl;

		if (suggestEl) {
			let container = suggestEl;
			if (
				!container.hasClass("suggestion-container") &&
				container.parentElement?.hasClass("suggestion-container")
			) {
				container = container.parentElement;
			}
			container.addClass("abstract-folder-suggestion-container");
		}

		const abstractFolderPaths: Set<string> = new Set();
		this.suggestionMetadata.clear();
		this.searchScores.clear();

		const files = this.app.vault.getAllLoadedFiles();
		const searchFn = prepareFuzzySearch(inputStr);

		// 1. Fuzzy Search Matches
		const scoredMatches: { path: string; result: SearchResult }[] = [];

		for (const file of files) {
			const result = searchFn(file.path);
			if (result) {
				scoredMatches.push({ path: file.path, result });
			}
		}

		scoredMatches.sort((a, b) => b.result.score - a.result.score);

		const topMatches = scoredMatches.slice(0, 50);

		for (const match of topMatches) {
			abstractFolderPaths.add(match.path);
			this.searchScores.set(match.path, match.result.score);
		}

		const topPaths = topMatches.map((m) => m.path);

		// 2. Add Context (Parents)
		if (this.settings.searchShowParents) {
			const graph = this.indexer.getGraph();
			for (const matchPath of topPaths) {
				const parents = graph.childToParents.get(matchPath);
				if (parents) {
					parents.forEach((p) => {
						if (!abstractFolderPaths.has(p)) {
							abstractFolderPaths.add(p);
							this.suggestionMetadata.set(
								p,
								`Parent of ${matchPath.split("/").pop()}`
							);
						}
					});
				} else {
					// Fallback for non-md files or missing reverse mappings
					for (const [parentPath, children] of Object.entries(graph.parentToChildren)) {
						if (children.has(matchPath)) {
							if (!abstractFolderPaths.has(parentPath)) {
								abstractFolderPaths.add(parentPath);
								this.suggestionMetadata.set(parentPath, `Parent of ${matchPath.split('/').pop()}`);
							}
						}
					}
				}
			}
		}

		// 3. Add Context (Children)
		if (this.settings.searchShowChildren) {
			const graph = this.indexer.getGraph();
			const parentToChildren = graph.parentToChildren;

			for (const matchPath of topPaths) {
				const children = parentToChildren[matchPath];
				if (children && children.size > 0) {
					children.forEach((c) => {
						if (!abstractFolderPaths.has(c)) {
							abstractFolderPaths.add(c);
							this.suggestionMetadata.set(
								c,
								`Child of ${matchPath.split("/").pop()}`
							);
						}
					});
				}
			}
		}

		// Sort: Direct matches first, then by fuzzy score, then alphabetical
		return Array.from(abstractFolderPaths).sort((a, b) => {
			const aIsContext = this.suggestionMetadata.has(a);
			const bIsContext = this.suggestionMetadata.has(b);

			if (aIsContext && !bIsContext) return 1;
			if (!aIsContext && bIsContext) return -1;

			if (!aIsContext && !bIsContext) {
				const scoreA = this.searchScores.get(a);
				const scoreB = this.searchScores.get(b);

				if (scoreA !== undefined && scoreB !== undefined) {
					return scoreB - scoreA;
				}
			}

			return a.localeCompare(b);
		});
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		const text = value;
		const suggestionEl = el.createDiv({
			cls: "abstract-folder-suggestion-item",
		});

		const mainText = suggestionEl.createDiv({ cls: "suggestion-content" });
		mainText.setText(text);

		const metadata = this.suggestionMetadata.get(value);
		if (metadata) {
			const aux = suggestionEl.createDiv({ cls: "suggestion-aux" });
			const iconSpan = aux.createSpan({ cls: "suggestion-icon" });
			setIcon(
				iconSpan,
				metadata.startsWith("Parent")
					? "arrow-up-left"
					: "arrow-down-right"
			);
			aux.createSpan({ text: metadata, cls: "suggestion-note" });
		}
	}

	selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
		this.inputEl.value = value;
		this.inputEl.trigger("input");
		this.close();
	}
}
