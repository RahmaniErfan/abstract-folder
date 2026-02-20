import { App, TFile } from "obsidian";
import { IGraphEngine } from "./core/graph-engine";
import { NodeMetrics } from "./types";
import AbstractFolderPlugin from "../main";

export class MetricsManager {
    private app: App;
    private graphEngine: IGraphEngine;
    private plugin: AbstractFolderPlugin;
    private metrics: Map<string, NodeMetrics> = new Map();

    constructor(app: App, graphEngine: IGraphEngine, plugin: AbstractFolderPlugin) {
        this.app = app;
        this.graphEngine = graphEngine;
        this.plugin = plugin;
        this.loadPersistedMetrics();
    }

    public clear() {
        this.metrics.clear();
    }

    private loadPersistedMetrics() {
        const persisted = this.plugin.settings.metrics || {};
        for (const [path, data] of Object.entries(persisted)) {
            this.metrics.set(path, {
                thermal: (data.thermal as number | undefined) || ((data as unknown as Record<string, number>).hotness) || 0,
                lastInteraction: data.lastInteraction,
                gravity: 0,
                rot: 0,
                complexity: 0
            });
        }
    }

    public async saveMetrics() {
        const toPersist: Record<string, { thermal: number; lastInteraction: number }> = {};
        this.metrics.forEach((m, path) => {
            if (m.thermal > 0.01) { // Only persist if it has significant heat
                toPersist[path] = {
                    thermal: m.thermal,
                    lastInteraction: m.lastInteraction
                };
            }
        });
        this.plugin.settings.metrics = toPersist;
        await this.plugin.saveSettings();
    }

    public getMetrics(path: string): NodeMetrics {
        let m = this.metrics.get(path);
        if (!m) {
            m = { thermal: 0, lastInteraction: Date.now(), gravity: 0, rot: 0, complexity: 0 };
            this.metrics.set(path, m);
        }
        return m;
    }

    /**
     * Hotness Logic: Exponential decay.
     * Decay by 20% every 24 hours.
     * Formula: score * (0.8 ^ (hours_passed / 24))
     */
    public applyDecay() {
        const now = Date.now();
        const decayRate = 0.8;
        const msPerDay = 24 * 60 * 60 * 1000;

        this.metrics.forEach((m, path) => {
            const daysPassed = (now - m.lastInteraction) / msPerDay;
            if (daysPassed > 0) {
                m.thermal = m.thermal * Math.pow(decayRate, daysPassed);
                m.lastInteraction = now;
            }
        });
    }

    public onInteraction(path: string) {
        this.applyDecay();
        const m = this.getMetrics(path);
        m.thermal += 1;
        m.lastInteraction = Date.now();
        void this.saveMetrics();
    }

    /**
     * Recalculate graph-based metrics: Payload and Rot.
     */
    public calculateGraphMetrics() {
        const memoGravity = new Map<string, number>();

        const getGravity = (path: string): number => {
            if (memoGravity.has(path)) return memoGravity.get(path)!;
            
            const children = this.graphEngine.getChildren(path);
            let count = 0;
            if (children) {
                children.forEach(childPath => {
                    count += 1 + getGravity(childPath);
                });
            }
            memoGravity.set(path, count);
            return count;
        };

        const now = Date.now();
        const msPerDay = 24 * 60 * 60 * 1000;

        // Note: graphEngine needs an efficient way to get all registered file paths
        // For now we might need to rely on what's indexed, but getDiagnosticDump gives keys
        const dump = this.graphEngine.getDiagnosticDump();
        const allPaths = Object.keys(dump);

        allPaths.forEach(path => {
            const m = this.getMetrics(path);
            const gravity = getGravity(path);
            const directChildren = this.graphEngine.getChildren(path)?.length || 0;
            
            m.gravity = gravity;
            m.complexity = directChildren;

            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const daysSinceEdit = (now - file.stat.mtime) / msPerDay;
                // Rot = Inactivity (days) * Complexity (number of abstract children)
                m.rot = daysSinceEdit * directChildren;
            } else {
                m.rot = 0;
            }
        });
    }
}
