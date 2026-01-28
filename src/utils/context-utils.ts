export function getContextualId(path: string, parentPath: string | null): string {
    return `${parentPath || "root"} > ${path}`;
}
