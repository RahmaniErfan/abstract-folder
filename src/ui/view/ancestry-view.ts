import { ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import * as cytoscape from "cytoscape";
// @ts-ignore - cytoscape-dagre lacks proper type definitions
import dagre from "cytoscape-dagre";
import { AncestryEngine } from "../../utils/ancestry";
import AbstractFolderPlugin from "../../../main";
import { PathSuggest } from "../path-suggest";

// Define missing types for cytoscape-dagre
declare module "cytoscape" {
	interface Core {
		layout(options: { name: string; [key: string]: unknown }): {
			run(): void;
		};
	}
}

// cytoscape-dagre registration
// The correct way to use plugins is through the .use() method on the default export/function
const cytoscapeAny = cytoscape as unknown as {
	use: (p: unknown) => void;
	default?: { use: (p: unknown) => void };
};

// Try registering on both to be safe
if (typeof cytoscapeAny.use === "function" && dagre) {
	try {
		cytoscapeAny.use(dagre);
	} catch (e) {
		console.error("Abstract Folder: Failed to register cytoscape-dagre plugin", e);
	}
}
const defaultCytoscape = cytoscapeAny.default as unknown as { use: (p: unknown) => void };
if (defaultCytoscape && typeof defaultCytoscape.use === "function" && dagre) {
	try {
		defaultCytoscape.use(dagre);
	} catch (e) {
		console.error("Abstract Folder: Failed to register dagre on default", e);
	}
}

export const VIEW_TYPE_ANCESTRY = "abstract-folder-ancestry-view";

export class AncestryView extends ItemView {
	private cy: cytoscape.Core | null = null;
	private engine: AncestryEngine;
	private targetFile: TFile | null = null;
	private searchInput: HTMLInputElement;

	constructor(leaf: WorkspaceLeaf, private plugin: AbstractFolderPlugin) {
		super(leaf);
		this.engine = new AncestryEngine(this.plugin.indexer);
	}

	getViewType(): string {
		return VIEW_TYPE_ANCESTRY;
	}

	getDisplayText(): string {
		return "Ancestry graph";
	}

	getIcon(): string {
		return "info";
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("abstract-folder-ancestry-container");

		// Create Search Header
		const headerEl = container.createDiv({ cls: "ancestry-header" });
		const searchContainer = headerEl.createDiv({ cls: "ancestry-search-container" });
		
		const searchIconEl = searchContainer.createDiv({ cls: "ancestry-search-icon" });
		setIcon(searchIconEl, "search");

		this.searchInput = searchContainer.createEl("input", {
			type: "text",
			placeholder: "Search file to view ancestry...",
			cls: "ancestry-search-input"
		});

		// Initialize Suggestion
		new PathSuggest(this.app, this.searchInput);

		// Handle Selection
		this.searchInput.addEventListener("input", () => {
			const path = this.searchInput.value;
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				this.updateGraph(file);
			}
		});

		const graphEl = container.createDiv({ cls: "ancestry-graph-canvas" });

		// cytoscape is both a namespace and a factory function
		const cytoscapeFunc = (cytoscapeAny.default || cytoscapeAny) as unknown as (
			o: unknown
		) => cytoscape.Core;
		this.cy = cytoscapeFunc({
			container: graphEl,
			boxSelectionEnabled: false,
			autounselectify: true,
			style: this.getGraphStyle() as cytoscape.StylesheetJson,
			layout: { name: "dagre" },
		});

		if (this.cy) {
			this.cy.on("tap", "node", (evt: cytoscape.EventObject) => {
				const targetNode = evt.target as cytoscape.NodeSingular;
				const fullPath = targetNode.data("fullPath") as string;
				if (fullPath) {
					const file = this.app.vault.getAbstractFileByPath(fullPath);
					if (file instanceof TFile) {
						void this.app.workspace.getLeaf(false).openFile(file);
					}
				}
			});
		}

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file instanceof TFile) {
					this.updateGraph(file);
					if (this.searchInput) {
						this.searchInput.value = file.path;
					}
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on(
				"abstract-folder:graph-updated" as "quick-preview",
				() => {
					if (this.targetFile) {
						this.updateGraph(this.targetFile);
					}
				}
			)
		);

		// Initial render if there is an active file
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			this.updateGraph(activeFile);
		}
	}

	async onClose() {
		if (this.cy) {
			this.cy.destroy();
			this.cy = null;
		}
	}

	public updateGraph(file: TFile) {
		if (!this.cy) return;
		this.targetFile = file;

		// Update search input if it's not already correct
		if (this.searchInput && this.searchInput.value !== file.path) {
			this.searchInput.value = file.path;
		}

		const data = this.engine.getAncestryGraphData(file.path);

		this.cy.elements().remove();
		this.cy.add([
			...(data.nodes as unknown as cytoscape.ElementDefinition[]),
			...(data.edges as unknown as cytoscape.ElementDefinition[]),
		]);

		// Update styling with theme-aware colors
		this.cy.style(this.getGraphStyle() as cytoscape.StylesheetStyle[]);

		const layout = this.cy.layout({
			name: "dagre",
			rankDir: "TB",
			spacingFactor: 1.2,
		});

		if (layout && typeof layout.run === "function") {
			layout.run();
		}

		this.cy.fit();
	}

	private getGraphStyle(): unknown {
		const isDark = document.body.classList.contains("theme-dark");
		
		// Use computed styles to get real theme colors
		const bodyStyle = getComputedStyle(document.body);
		const textColor = bodyStyle.getPropertyValue("--text-normal").trim() || (isDark ? "#dcddde" : "#2e3338");
		const edgeColor = bodyStyle.getPropertyValue("--text-muted").trim() || (isDark ? "#888" : "#666"); // Darker than border color
		const accentColor = bodyStyle.getPropertyValue("--interactive-accent").trim() || (isDark ? "#7551ec" : "#483699");
		const bgColor = bodyStyle.getPropertyValue("--background-secondary-alt").trim() || (isDark ? "#202020" : "#ffffff");
		const nodeBorderColor = bodyStyle.getPropertyValue("--background-modifier-border-hover").trim() || edgeColor;

		return [
			{
				selector: "node",
				style: {
					label: "data(label)",
					"text-valign": "center",
					"text-halign": "center",
					"font-size": "11px",
					color: textColor,
					"background-color": bgColor,
					"border-width": "1.5px",
					"border-color": nodeBorderColor,
					width: "110px",
					height: "38px",
					shape: "round-rectangle",
					"text-wrap": "ellipsis",
					"text-max-width": "100px",
					"corner-radius": "6px"
				},
			},
			{
				selector: 'node[type="target"]',
				style: {
					"background-color": accentColor,
					color: "var(--text-on-accent)",
					"border-width": "0px",
					"font-weight": "bold",
					"font-size": "12px",
					"width": "120px",
					"height": "42px"
				},
			},
			{
				selector: 'node[type="root"]',
				style: {
					"border-width": "2.5px",
					"border-color": accentColor,
				},
			},
			{
				selector: 'node[type="sibling"]',
				style: {
					opacity: 0.7,
					"font-style": "italic",
				},
			},
			{
				selector: "edge",
				style: {
					width: 2.5,
					"line-color": edgeColor,
					"target-arrow-color": edgeColor,
					"target-arrow-shape": "triangle",
					"arrow-scale": 1.2,
					"curve-style": "bezier",
					"target-endpoint": "outside-to-node",
					"line-style": "solid",
					"opacity": 0.75
				},
			},
			{
				selector: 'edge[type="sibling"]',
				style: {
					"line-style": "dashed",
					"opacity": 0.3,
					"width": 2
				}
			},
			{
				selector: "node:active",
				style: {
					"overlay-color": accentColor,
					"overlay-opacity": 0.2,
					"background-color": "var(--background-modifier-hover)"
				}
			}
		];
	}
}
