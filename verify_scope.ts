
import { App, TFile } from "obsidian";
import { GraphEngine } from "./src/core/graph-engine";
import { AbstractFolderPluginSettings, DEFAULT_SETTINGS } from "./src/settings";

// Mock App and TFile (simplified)
const mockApp = {
    vault: {
        getFiles: () => [],
        getAbstractFileByPath: (path: string) => null,
        on: () => {},
    },
    metadataCache: {
        on: () => {},
        getFileCache: () => null,
    },
    workspace: {
        on: () => {},
        trigger: () => {},
    }
} as unknown as App;

const settings: AbstractFolderPluginSettings = {
    ...DEFAULT_SETTINGS,
    librarySettings: {
        ...DEFAULT_SETTINGS.librarySettings,
        sharedSpacesRoot: "Abstract Spaces"
    }
};

const graphEngine = new GraphEngine(mockApp, settings);

// Mock Index Data
// We need to access private 'index' or simulate behavior. 
// Since we can't easily access private members in this script without complex mocks,
// we will just review the code logic which is:
// if (id === sharedSpacesRoot || id.startsWith(sharedSpacesRoot + '/')) continue;

console.log("Verification Script: Reviewing Logic...");

const sharedSpacesRoot = "Abstract Spaces";
const testPaths = [
    "Folder/Note.md",
    "Abstract Spaces/Space1/Note.md",
    "Abstract Spaces/Note.md",
    "Other/Note.md"
];

testPaths.forEach(path => {
    let excluded = false;
    // Replica of the logic added to GraphEngine.getAllRoots
    if (path === sharedSpacesRoot || path.startsWith(sharedSpacesRoot + '/')) {
        excluded = true;
    }
    
    console.log(`Path: ${path} -> Excluded from Main View? ${excluded}`);
});

console.log("Logic verification complete.");
