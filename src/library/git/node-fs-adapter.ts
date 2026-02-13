import * as fs from 'fs';
import * as path from 'path';

/**
 * A standard Node.js FS-like interface for isomorphic-git 
 * that points to the actual filesystem.
 */
export const NodeFsAdapter = {
    promises: fs.promises
};
