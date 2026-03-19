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
import { execFile } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function readFileFromWSL(path: string): Promise<string> {
	return withFilesystemError(() => readFile(path, 'utf8'), 'Failed to read file');
}

export async function readFileRangeFromWSL(path: string, startLine: number, endLine: number): Promise<string> {
	const content = await withFilesystemError(() => readFile(path, 'utf8'), 'Failed to read file');
	if (content.length === 0) {
		throw new Error(`start_line ${startLine} is beyond end of file (0 lines)`);
	}
	const lines = content.split(/\r?\n/);

	if (startLine > lines.length) {
		throw new Error(`start_line ${startLine} is beyond end of file (${lines.length} lines)`);
	}

	const selectedLines = lines.slice(startLine - 1, endLine);
	return selectedLines.map((line, index) => `${startLine + index}: ${line}`).join('\n');
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

export async function statPathInWSL(path: string): Promise<string> {
	try {
		const linkStat = await lstat(path);
		const result: Record<string, unknown> = {
			exists: true,
			kind: getPathKind(linkStat),
			size: linkStat.size,
			mtime_ms: linkStat.mtimeMs,
			mode: linkStat.mode,
			is_symlink: linkStat.isSymbolicLink(),
		};

		if (linkStat.isSymbolicLink()) {
			try {
				const targetStat = await stat(path);
				result.symlink_target_kind = getPathKind(targetStat);
				result.target_size = targetStat.size;
				result.target_mtime_ms = targetStat.mtimeMs;
			} catch (err) {
				result.symlink_target_error = formatError(err);
			}
		}

		return JSON.stringify(result, null, 2);
	} catch (err) {
		if (isErrnoException(err) && err.code === 'ENOENT') {
			return JSON.stringify(
				{
					exists: false,
				},
				null,
				2
			);
		}
		throw new Error(`Failed to stat path: ${formatError(err)}`);
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

export async function grepContentInWSL(input: {
	path: string;
	pattern: string;
	glob?: string;
	caseSensitive?: boolean;
	isRegex?: boolean;
	maxResults?: number;
}): Promise<string> {
	try {
		return await grepContentWithRipgrep(input);
	} catch (err) {
		if (!isCommandMissingError(err)) {
			throw err instanceof Error ? err : new Error(String(err));
		}
	}

	return grepContentWithNode(input);
}

async function grepContentWithRipgrep(input: {
	path: string;
	pattern: string;
	glob?: string;
	caseSensitive?: boolean;
	isRegex?: boolean;
	maxResults?: number;
}): Promise<string> {
	const args = ['--line-number', '--with-filename', '--color', 'never', '--no-heading'];

	if (!input.caseSensitive) {
		args.push('-i');
	}
	if (!input.isRegex) {
		args.push('-F');
	}
	if (input.glob) {
		args.push('-g', input.glob);
	}

	args.push(input.pattern, input.path);

	try {
		const { stdout } = await execFileAsync('rg', args, {
			encoding: 'utf8',
			maxBuffer: 10 * 1024 * 1024,
		});
		return formatGrepOutput(stdout, input.maxResults);
	} catch (err) {
		if (isExecFileError(err) && getExecExitCode(err) === 1) {
			return '(no matches)';
		}
		if (isExecFileError(err) && err.code !== 'ENOENT') {
			const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
			if (stderr.length > 0) {
				throw new Error(stderr);
			}
			if (typeof err.stdout === 'string' && err.stdout.trim().length > 0) {
				return formatGrepOutput(err.stdout, input.maxResults);
			}
		}
		throw err;
	}
}

async function grepContentWithNode(input: {
	path: string;
	pattern: string;
	glob?: string;
	caseSensitive?: boolean;
	isRegex?: boolean;
	maxResults?: number;
}): Promise<string> {
	const target = await lstat(input.path).catch((err) => {
		throw new Error(`Failed to inspect search path: ${formatError(err)}`);
	});
	const matches: string[] = [];
	const globRegex = input.glob ? globToRegex(input.glob) : null;
	const patternRegex = input.isRegex ? new RegExp(input.pattern, input.caseSensitive ? 'g' : 'gi') : null;
	const normalizedNeedle = input.caseSensitive ? input.pattern : input.pattern.toLowerCase();

	async function walk(currentPath: string): Promise<void> {
		if (input.maxResults !== undefined && matches.length >= input.maxResults) {
			return;
		}

		const currentTarget = await lstat(currentPath).catch((err) => {
			throw new Error(`Failed to inspect path during content search: ${formatError(err)}`);
		});

		if (currentTarget.isDirectory()) {
			const entries = sortEntries(await readdir(currentPath, { withFileTypes: true }));
			for (const entry of entries) {
				if (input.maxResults !== undefined && matches.length >= input.maxResults) {
					return;
				}
				await walk(join(currentPath, entry.name));
			}
			return;
		}

		const fileName = currentPath.split('/').pop() ?? currentPath;
		if (globRegex && !globRegex.test(fileName)) {
			return;
		}

		const content = await readFile(currentPath, 'utf8').catch(() => null);
		if (content === null) {
			return;
		}

		const lines = content.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			if (input.maxResults !== undefined && matches.length >= input.maxResults) {
				return;
			}

			const line = lines[i];
			const isMatch = patternRegex
				? patternRegex.test(line)
				: (input.caseSensitive ? line : line.toLowerCase()).includes(normalizedNeedle);

			if (!isMatch) {
				if (patternRegex) {
					patternRegex.lastIndex = 0;
				}
				continue;
			}

			matches.push(`${currentPath}:${i + 1}:${line}`);
			if (patternRegex) {
				patternRegex.lastIndex = 0;
			}
		}
	}

	if (target.isDirectory()) {
		await walk(input.path);
	} else {
		await walk(input.path);
	}

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

function formatGrepOutput(output: string, maxResults?: number): string {
	const lines = output
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);

	if (lines.length === 0) {
		return '(no matches)';
	}

	return (maxResults === undefined ? lines : lines.slice(0, maxResults)).join('\n');
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

function getPathKind(target: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): string {
	if (target.isFile()) {
		return 'file';
	}
	if (target.isDirectory()) {
		return 'dir';
	}
	if (target.isSymbolicLink()) {
		return 'symlink';
	}
	return 'other';
}

function isExecFileError(
	err: unknown
): err is Error & NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number } {
	return err instanceof Error;
}

function isCommandMissingError(err: unknown): boolean {
	return isExecFileError(err) && err.code === 'ENOENT';
}

function getExecExitCode(err: Error & NodeJS.ErrnoException & { code?: string | number }): number | null {
	return typeof err.code === 'number' ? err.code : null;
}

function globToRegex(pattern: string): RegExp {
	return new RegExp(
		'^' +
			pattern
				.replace(/[.+^${}()|[\]\\]/g, '\\$&')
				.replace(/\*/g, '.*')
				.replace(/\?/g, '.') +
			'$'
	);
}

function sortEntries<T extends { name: string }>(entries: T[]): T[] {
	return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}
