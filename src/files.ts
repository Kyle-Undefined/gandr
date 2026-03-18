import {
    readFile,
    writeFile,
    appendFile,
    readdir,
    stat,
    rm,
    rename,
    mkdir,
    access,
    copyFile,
    lstat,
} from 'fs/promises';
import { join } from 'path';

export async function readFileFromWSL(path: string): Promise<string> {
    return withFilesystemError(() => readFile(path, 'utf8'), 'Failed to read file');
}

export async function writeFileToWSL(path: string, content: string): Promise<void> {
    await withFilesystemError(() => writeFile(path, content, 'utf8'), 'Failed to write file');
}

export async function listDirInWSL(path: string): Promise<string> {
    try {
        const entries = sortEntries(await readdir(path, { withFileTypes: true }));
        const lines: string[] = [];

        for (const entry of entries) {
            const fullPath = join(path, entry.name);
            try {
                const s = await stat(fullPath);
                const type = entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'symlink' : 'file';
                const size = entry.isFile() ? ` (${s.size} bytes)` : '';
                lines.push(`[${type}] ${entry.name}${size}`);
            } catch {
                lines.push(`[?] ${entry.name}`);
            }
        }

        return lines.join('\n');
    } catch (err) {
        throw new Error(`Failed to list directory: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export async function deleteFileFromWSL(path: string): Promise<void> {
    try {
        const target = await lstat(path);
        if (target.isDirectory()) {
            throw new Error('delete_file only supports files and symlinks');
        }
        await rm(path, { recursive: false, force: false });
    } catch (err) {
        throw new Error(`Failed to delete file: ${formatError(err)}`);
    }
}

export async function deleteDirFromWSL(path: string): Promise<void> {
    try {
        const target = await lstat(path);
        if (!target.isDirectory()) {
            throw new Error('delete_dir only supports directories');
        }
        await rm(path, { recursive: true, force: false });
    } catch (err) {
        throw new Error(`Failed to delete directory: ${formatError(err)}`);
    }
}

export async function moveFileInWSL(from: string, to: string): Promise<void> {
    await withFilesystemError(() => rename(from, to), 'Failed to move file');
}

export async function fileExistsInWSL(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch (err) {
        if (isErrnoException(err) && err.code === 'ENOENT') {
            return false;
        }
        throw new Error(`Failed to check file existence: ${formatError(err)}`);
    }
}

export async function createDirInWSL(path: string): Promise<void> {
    await withFilesystemError(() => mkdir(path, { recursive: true }), 'Failed to create directory');
}

export async function appendFileToWSL(path: string, content: string): Promise<void> {
    await withFilesystemError(() => appendFile(path, content, 'utf8'), 'Failed to append to file');
}

export async function patchFileInWSL(path: string, oldStr: string, newStr: string): Promise<void> {
    if (oldStr.length === 0) {
        throw new Error('old_str must not be empty');
    }

    let content: string;
    try {
        content = await readFile(path, 'utf8');
    } catch (err) {
        throw new Error(`Failed to read file for patching: ${err instanceof Error ? err.message : String(err)}`);
    }

    const firstIndex = content.indexOf(oldStr);
    if (firstIndex === -1) {
        throw new Error('old_str not found in file');
    }

    const secondIndex = content.indexOf(oldStr, firstIndex + 1);
    if (secondIndex !== -1) {
        const count = countOverlappingOccurrences(content, oldStr);
        throw new Error(`old_str is ambiguous - found ${count} occurrences, expected exactly 1`);
    }

    const patched = `${content.slice(0, firstIndex)}${newStr}${content.slice(firstIndex + oldStr.length)}`;
    await withFilesystemError(() => writeFile(path, patched, 'utf8'), 'Failed to write patched file');
}

export async function copyFileInWSL(from: string, to: string): Promise<void> {
    await withFilesystemError(() => copyFile(from, to), 'Failed to copy file');
}

export async function readDirTreeInWSL(path: string, maxDepth?: number): Promise<string> {
    const lines: string[] = [];

    async function walk(dir: string, prefix: string, depth: number): Promise<void> {
        if (maxDepth !== undefined && depth > maxDepth) return;

        let entries;
        try {
            entries = sortEntries(await readdir(dir, { withFileTypes: true }));
        } catch (err) {
            lines.push(`${prefix}[error] ${formatError(err)}`);
            return;
        }

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const isLast = i === entries.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const childPrefix = isLast ? prefix + '    ' : prefix + '│   ';

            if (entry.isDirectory()) {
                lines.push(`${prefix}${connector}${entry.name}/`);
                await walk(join(dir, entry.name), childPrefix, depth + 1);
            } else {
                try {
                    const s = await stat(join(dir, entry.name));
                    lines.push(`${prefix}${connector}${entry.name} (${s.size} bytes)`);
                } catch {
                    lines.push(`${prefix}${connector}${entry.name}`);
                }
            }
        }
    }

    await walk(path, '', 0);
    return lines.join('\n');
}

export async function searchFilesInWSL(path: string, pattern: string): Promise<string> {
    const matches: string[] = [];
    const regex = new RegExp(
        '^' +
            pattern
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.') +
            '$'
    );

    async function walk(dir: string): Promise<void> {
        let entries;
        try {
            entries = sortEntries(await readdir(dir, { withFileTypes: true }));
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (regex.test(entry.name)) {
                matches.push(fullPath);
            }
        }
    }

    await walk(path);
    return matches.length > 0 ? matches.join('\n') : '(no matches)';
}

async function withFilesystemError<T>(action: () => Promise<T>, prefix: string): Promise<T> {
    try {
        return await action();
    } catch (err) {
        throw new Error(`${prefix}: ${formatError(err)}`);
    }
}

function formatError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function countOverlappingOccurrences(content: string, target: string): number {
    let count = 0;
    let start = 0;

    while (start <= content.length - target.length) {
        const index = content.indexOf(target, start);
        if (index === -1) {
            break;
        }
        count++;
        start = index + 1;
    }

    return count;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
    return err instanceof Error;
}

function sortEntries<T extends { name: string }>(entries: T[]): T[] {
    return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}
