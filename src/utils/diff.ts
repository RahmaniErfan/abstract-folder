export interface DiffResult {
    value: string;
    added?: boolean;
    removed?: boolean;
}

export interface DiffBlock {
    type: 'unchanged' | 'conflict';
    localLines: string[];
    remoteLines: string[];
    localStartLine: number;
    remoteStartLine: number;
}

/**
 * Basic line-by-line diff using Longest Common Subsequence,
 * grouped into unchanged and conflict blocks.
 */
export function diffLines(oldStr: string, newStr: string): DiffBlock[] {
    const oldLines = oldStr.split(/\r?\n/);
    const newLines = newStr.split(/\r?\n/);

    const matrix: number[][] = Array(oldLines.length + 1).fill(null).map(() => Array(newLines.length + 1).fill(0));

    for (let i = 1; i <= oldLines.length; i++) {
        for (let j = 1; j <= newLines.length; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1] + 1;
            } else {
                matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
            }
        }
    }

    const result: DiffResult[] = [];
    let i = oldLines.length;
    let j = newLines.length;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            result.unshift({ value: oldLines[i - 1] });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
            result.unshift({ value: newLines[j - 1], added: true });
            j--;
        } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
            result.unshift({ value: oldLines[i - 1], removed: true });
            i--;
        }
    }

    // Group into blocks
    const blocks: DiffBlock[] = [];
    let currentBlock: DiffBlock | null = null;
    let currentLocalLine = 1;
    let currentRemoteLine = 1;

    for (const diff of result) {
        if (!diff.added && !diff.removed) {
            // Unchanged line
            if (!currentBlock || currentBlock.type !== 'unchanged') {
                if (currentBlock) blocks.push(currentBlock);
                currentBlock = {
                    type: 'unchanged',
                    localLines: [],
                    remoteLines: [],
                    localStartLine: currentLocalLine,
                    remoteStartLine: currentRemoteLine,
                };
            }
            currentBlock.localLines.push(diff.value);
            currentBlock.remoteLines.push(diff.value);
            currentLocalLine++;
            currentRemoteLine++;
        } else {
            // Changed line (conflict)
            if (!currentBlock || currentBlock.type !== 'conflict') {
                if (currentBlock) blocks.push(currentBlock);
                currentBlock = {
                    type: 'conflict',
                    localLines: [],
                    remoteLines: [],
                    localStartLine: currentLocalLine,
                    remoteStartLine: currentRemoteLine,
                };
            }
            if (diff.removed) {
                currentBlock.localLines.push(diff.value);
                currentLocalLine++;
            }
            if (diff.added) {
                currentBlock.remoteLines.push(diff.value);
                currentRemoteLine++;
            }
        }
    }

    if (currentBlock) {
        blocks.push(currentBlock);
    }

    return blocks;
}
