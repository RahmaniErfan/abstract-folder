import { App, TFile, TFolder } from "obsidian";

/**
 * Sanitizes a topic name for use as a folder or file name.
 * Replaces :, /, \, ? with - as per OS restrictions.
 */
export function sanitizeTopicName(name: string): string {
    return name.replace(/[:/\\?]/g, "-");
}
