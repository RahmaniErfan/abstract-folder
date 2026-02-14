import { ContextEngine } from "../../core/context-engine";
import { TreeCoordinator } from "../../core/tree-coordinator";

/**
 * BaseFacet is the foundational class for modular UI components in the SOVM architecture.
 */
export abstract class BaseFacet {
    protected subscriptions: (() => void)[] = [];

    constructor(
        protected containerEl: HTMLElement,
        protected contextEngine: ContextEngine,
        protected treeCoordinator: TreeCoordinator
    ) {}

    /**
     * Lifecycle: Called when the facet is mounted into the view.
     */
    abstract onMount(): void;

    /**
     * Lifecycle: Called when the facet is being destroyed.
     */
    onDestroy(): void {
        this.subscriptions.forEach(unsub => unsub());
        this.subscriptions = [];
        this.containerEl.empty();
    }

    /**
     * Utility to register state subscriptions.
     */
    protected subscribe(unsub: () => void) {
        this.subscriptions.push(unsub);
    }
}
