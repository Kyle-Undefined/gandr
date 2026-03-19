import { runClaudeTask } from './claude';
import type { Logger } from './logger';
import {
	appendFileToWSL,
	copyFileInWSL,
	createDirInWSL,
	deleteDirFromWSL,
	deleteFileFromWSL,
	fileExistsInWSL,
	grepContentInWSL,
	listDirInWSL,
	moveFileInWSL,
	patchFileInWSL,
	readFileRangeFromWSL,
	readDirTreeInWSL,
	readFileFromWSL,
	searchFilesInWSL,
	statPathInWSL,
	writeFileToWSL,
} from './files';
import type {
	AppendFileInput,
	CopyFileInput,
	CreateDirInput,
	DeleteDirInput,
	DeleteFileInput,
	FileExistsInput,
	GrepContentInput,
	ListDirInput,
	MoveFileInput,
	PatchFileInput,
	ReadDirTreeInput,
	ReadFileInput,
	ReadFileRangeInput,
	SearchFilesInput,
	StatPathInput,
	ToolCallParams,
	ToolCallResult,
	ToolDefinition,
	WeaveGandrInput,
	WriteFileInput,
} from './types';
import {
	isAppendFileInput,
	isCopyFileInput,
	isCreateDirInput,
	isDeleteDirInput,
	isDeleteFileInput,
	isFileExistsInput,
	isGrepContentInput,
	isListDirInput,
	isMoveFileInput,
	isPatchFileInput,
	isReadDirTreeInput,
	isReadFileInput,
	isReadFileRangeInput,
	isSearchFilesInput,
	isStatPathInput,
	isWeaveGandrInput,
	isWriteFileInput,
} from './types';

export type ToolExecutionContext = {
	logger: Logger;
	claudeTimeoutMs: number | null;
};

type ToolEntry<TInput extends Record<string, unknown>> = {
	definition: ToolDefinition;
	invalidArgumentsMessage: string;
	absolutePathKeys?: readonly (keyof TInput & string)[];
	absolutePathErrorMessage?: string;
	validate: (value: unknown) => value is TInput;
	execute: (input: TInput, context: ToolExecutionContext) => Promise<string>;
};

type ToolExecutionError = {
	kind: 'error';
	code: number;
	message: string;
};

type ToolExecutionSuccess = {
	kind: 'result';
	result: ToolCallResult;
};

export type ToolExecutionOutcome = ToolExecutionError | ToolExecutionSuccess;

type ToolInput = Record<string, unknown>;
type RuntimeToolEntry = {
	definition: ToolDefinition;
	invalidArgumentsMessage: string;
	absolutePathKeys?: readonly string[];
	absolutePathErrorMessage?: string;
	validate: (value: unknown) => value is ToolInput;
	execute: (input: ToolInput, context: ToolExecutionContext) => Promise<string>;
};

function defineTool<TInput extends ToolInput>(entry: ToolEntry<TInput>): RuntimeToolEntry {
	return {
		...entry,
		validate: (value: unknown): value is ToolInput => entry.validate(value),
		execute: (input: ToolInput, context: ToolExecutionContext) => entry.execute(input as TInput, context),
	};
}

function runWithMessage<TInput extends ToolInput>(
	action: (input: TInput) => Promise<void>,
	message: (input: TInput) => string
): (input: TInput, context: ToolExecutionContext) => Promise<string> {
	return async (input: TInput, _context: ToolExecutionContext) => {
		await action(input);
		return message(input);
	};
}

const toolEntries = [
	defineTool({
		definition: {
			name: 'gandr',
			description:
				'Weave a task through Gandr to Claude Code running in WSL. Primary tool for all coding, agentic, and multi-step tasks in WSL. Routes through Claude Code which has full shell access, respects all CC hooks, permissions, and configs. Prefer this over direct tools whenever the task involves reasoning, multiple steps, running commands, installing packages, git operations, or modifying code. Direct tools are only for simple, already-known file I/O.',
			inputSchema: {
				type: 'object',
				properties: {
					prompt: {
						type: 'string',
						description: 'The task to perform.',
					},
					cwd: {
						type: 'string',
						description:
							'Working directory inside WSL to run the task in. Defaults to the user home directory if not provided.',
					},
					context: {
						type: 'string',
						description:
							'Optional background context from the conversation to help Claude Code understand the task. Include relevant prior decisions, architecture notes, or multi-step plan details.',
					},
				},
				required: ['prompt'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for gandr',
		validate: isWeaveGandrInput,
		execute: async (input: WeaveGandrInput, context: ToolExecutionContext) =>
			runClaudeTask(input, {
				logger: context.logger,
				claudeTimeoutMs: context.claudeTimeoutMs,
			}),
	}),
	defineTool({
		definition: {
			name: 'read_file',
			description:
				'Read the contents of a file from the WSL filesystem directly. Use for quick file reads that do not require Claude Code reasoning - faster and cheaper than weaving through Gandr.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to the file inside WSL.',
					},
				},
				required: ['path'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for read_file',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'read_file requires an absolute path',
		validate: isReadFileInput,
		execute: async (input: ReadFileInput) => readFileFromWSL(input.path),
	}),
	defineTool({
		definition: {
			name: 'read_file_range',
			description:
				'Read a specific inclusive line range from a file in the WSL filesystem directly. Use for large files and logs when a full read would be wasteful. Returns the selected lines prefixed with line numbers.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to the file inside WSL.',
					},
					start_line: {
						type: 'number',
						description: 'First line number to include. Must be a positive integer.',
					},
					end_line: {
						type: 'number',
						description: 'Last line number to include. Must be a positive integer and at least start_line.',
					},
				},
				required: ['path', 'start_line', 'end_line'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for read_file_range',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'read_file_range requires an absolute path',
		validate: isReadFileRangeInput,
		execute: async (input: ReadFileRangeInput) => readFileRangeFromWSL(input.path, input.start_line, input.end_line),
	}),
	defineTool({
		definition: {
			name: 'write_file',
			description:
				'Write or overwrite a file in the WSL filesystem directly. Use for simple file writes where the content is already known - faster and cheaper than weaving through Gandr.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to the file inside WSL.',
					},
					content: {
						type: 'string',
						description: 'Full content to write to the file.',
					},
				},
				required: ['path', 'content'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for write_file',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'write_file requires an absolute path',
		validate: isWriteFileInput,
		execute: runWithMessage(
			(input: WriteFileInput) => writeFileToWSL(input.path, input.content),
			(input) => `Written: ${input.path}`
		),
	}),
	defineTool({
		definition: {
			name: 'list_dir',
			description:
				'List the contents of a directory in the WSL filesystem directly. Use for quick directory listings that do not require Claude Code reasoning.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to the directory inside WSL.',
					},
				},
				required: ['path'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for list_dir',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'list_dir requires an absolute path',
		validate: isListDirInput,
		execute: async (input: ListDirInput) => listDirInWSL(input.path),
	}),
	defineTool({
		definition: {
			name: 'delete_file',
			description:
				'Delete a file from the WSL filesystem directly. Use for simple file deletions that do not require Claude Code reasoning - faster and cheaper than weaving through Gandr.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to the file inside WSL.',
					},
				},
				required: ['path'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for delete_file',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'delete_file requires an absolute path',
		validate: isDeleteFileInput,
		execute: runWithMessage(
			(input: DeleteFileInput) => deleteFileFromWSL(input.path),
			(input) => `Deleted: ${input.path}`
		),
	}),
	defineTool({
		definition: {
			name: 'delete_dir',
			description:
				'Delete a directory and its contents from the WSL filesystem directly. Use for simple directory removals that do not require Claude Code reasoning - faster and cheaper than weaving through Gandr.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to the directory inside WSL.',
					},
				},
				required: ['path'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for delete_dir',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'delete_dir requires an absolute path',
		validate: isDeleteDirInput,
		execute: runWithMessage(
			(input: DeleteDirInput) => deleteDirFromWSL(input.path),
			(input) => `Deleted directory: ${input.path}`
		),
	}),
	defineTool({
		definition: {
			name: 'move_file',
			description:
				'Move or rename a file or directory in the WSL filesystem directly. Use for simple move or rename operations that do not require Claude Code reasoning - faster and cheaper than weaving through Gandr.',
			inputSchema: {
				type: 'object',
				properties: {
					from: {
						type: 'string',
						description: 'Absolute path to the source file or directory inside WSL.',
					},
					to: {
						type: 'string',
						description: 'Absolute path to the destination inside WSL.',
					},
				},
				required: ['from', 'to'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for move_file',
		absolutePathKeys: ['from', 'to'],
		absolutePathErrorMessage: 'move_file requires absolute paths',
		validate: isMoveFileInput,
		execute: runWithMessage(
			(input: MoveFileInput) => moveFileInWSL(input.from, input.to),
			(input) => `Moved: ${input.from} -> ${input.to}`
		),
	}),
	defineTool({
		definition: {
			name: 'file_exists',
			description:
				'Check whether a file or directory exists in the WSL filesystem. Returns "true" or "false". Use before read or write operations to avoid errors - faster and cheaper than weaving through Gandr.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to check inside WSL.',
					},
				},
				required: ['path'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for file_exists',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'file_exists requires an absolute path',
		validate: isFileExistsInput,
		execute: async (input: FileExistsInput) => ((await fileExistsInWSL(input.path)) ? 'true' : 'false'),
	}),
	defineTool({
		definition: {
			name: 'stat_path',
			description:
				'Inspect a file, directory, or symlink in the WSL filesystem directly. Returns structured JSON text describing whether the path exists and, if it does, its kind, size, mtime, mode, and symlink metadata.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to inspect inside WSL.',
					},
				},
				required: ['path'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for stat_path',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'stat_path requires an absolute path',
		validate: isStatPathInput,
		execute: async (input: StatPathInput) => statPathInWSL(input.path),
	}),
	defineTool({
		definition: {
			name: 'create_dir',
			description:
				'Create a directory (and any missing parent directories) in the WSL filesystem directly. Use before writing files into new directories - faster and cheaper than weaving through Gandr.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to the directory to create inside WSL.',
					},
				},
				required: ['path'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for create_dir',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'create_dir requires an absolute path',
		validate: isCreateDirInput,
		execute: runWithMessage(
			(input: CreateDirInput) => createDirInWSL(input.path),
			(input) => `Created: ${input.path}`
		),
	}),
	defineTool({
		definition: {
			name: 'append_file',
			description:
				'Append content to the end of a file in the WSL filesystem directly. Creates the file if it does not exist. Use for logs, journals, and incremental writes - faster and cheaper than read-modify-write cycles.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to the file inside WSL.',
					},
					content: {
						type: 'string',
						description: 'Content to append to the file.',
					},
				},
				required: ['path', 'content'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for append_file',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'append_file requires an absolute path',
		validate: isAppendFileInput,
		execute: runWithMessage(
			(input: AppendFileInput) => appendFileToWSL(input.path, input.content),
			(input) => `Appended to: ${input.path}`
		),
	}),
	defineTool({
		definition: {
			name: 'patch_file',
			description:
				'Replace a unique string in a file in the WSL filesystem. old_str must appear exactly once and must not be empty. Use for surgical edits without a full read-rewrite cycle. Requires old_str to appear exactly once - verify with read_file first if unsure. Do not use for generated or large files where uniqueness is uncertain.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to the file inside WSL.',
					},
					old_str: {
						type: 'string',
						description: 'The exact string to find. Must appear exactly once in the file.',
					},
					new_str: {
						type: 'string',
						description: 'The string to replace it with.',
					},
				},
				required: ['path', 'old_str', 'new_str'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for patch_file',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'patch_file requires an absolute path',
		validate: isPatchFileInput,
		execute: runWithMessage(
			(input: PatchFileInput) => patchFileInWSL(input.path, input.old_str, input.new_str),
			(input) => `Patched: ${input.path}`
		),
	}),
	defineTool({
		definition: {
			name: 'copy_file',
			description:
				'Copy a file in the WSL filesystem directly. Use for simple file copies where no transformation is needed - faster and cheaper than weaving through Gandr.',
			inputSchema: {
				type: 'object',
				properties: {
					from: {
						type: 'string',
						description: 'Absolute path to the source file inside WSL.',
					},
					to: {
						type: 'string',
						description: 'Absolute path to the destination file inside WSL.',
					},
				},
				required: ['from', 'to'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for copy_file',
		absolutePathKeys: ['from', 'to'],
		absolutePathErrorMessage: 'copy_file requires absolute paths',
		validate: isCopyFileInput,
		execute: runWithMessage(
			(input: CopyFileInput) => copyFileInWSL(input.from, input.to),
			(input) => `Copied: ${input.from} -> ${input.to}`
		),
	}),
	defineTool({
		definition: {
			name: 'read_dir_tree',
			description:
				'Recursively list a directory tree in the WSL filesystem. Returns a formatted tree with file sizes. Use when exploring project structure to avoid multiple list_dir roundtrips. Optionally limit depth with max_depth.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to the root directory inside WSL.',
					},
					max_depth: {
						type: 'number',
						description: 'Optional maximum depth to recurse. Defaults to unlimited. Must be a positive integer.',
					},
				},
				required: ['path'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for read_dir_tree',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'read_dir_tree requires an absolute path',
		validate: isReadDirTreeInput,
		execute: async (input: ReadDirTreeInput) => readDirTreeInWSL(input.path, input.max_depth),
	}),
	defineTool({
		definition: {
			name: 'search_files',
			description:
				'Search for files matching a glob pattern recursively under a directory in the WSL filesystem. Returns absolute paths of all matches. Pure filesystem traversal - for content search (grep), use gandr instead.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to the root directory to search inside WSL.',
					},
					pattern: {
						type: 'string',
						description: 'Glob pattern to match filenames against (e.g. "*.ts", "*.test.*").',
					},
				},
				required: ['path', 'pattern'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for search_files',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'search_files requires an absolute path',
		validate: isSearchFilesInput,
		execute: async (input: SearchFilesInput) => searchFilesInWSL(input.path, input.pattern),
	}),
	defineTool({
		definition: {
			name: 'grep_content',
			description:
				'Search file contents under a file or directory in the WSL filesystem. Returns matches as path:line:content. Supports optional glob filtering, case sensitivity, regex mode, and result limiting. Use for fast direct text search instead of weaving through Gandr.',
			inputSchema: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Absolute path to a file or directory inside WSL to search within.',
					},
					pattern: {
						type: 'string',
						description: 'Pattern to search for in file contents.',
					},
					glob: {
						type: 'string',
						description: 'Optional glob to restrict filenames searched (e.g. "*.ts", "*.md").',
					},
					case_sensitive: {
						type: 'boolean',
						description: 'Whether matching should be case-sensitive. Defaults to false.',
					},
					is_regex: {
						type: 'boolean',
						description: 'Whether pattern should be treated as a regular expression. Defaults to false.',
					},
					max_results: {
						type: 'number',
						description: 'Optional maximum number of matching lines to return. Must be a positive integer.',
					},
				},
				required: ['path', 'pattern'],
			},
		},
		invalidArgumentsMessage: 'Invalid arguments for grep_content',
		absolutePathKeys: ['path'],
		absolutePathErrorMessage: 'grep_content requires an absolute path',
		validate: isGrepContentInput,
		execute: async (input: GrepContentInput) =>
			grepContentInWSL({
				path: input.path,
				pattern: input.pattern,
				glob: input.glob,
				caseSensitive: input.case_sensitive,
				isRegex: input.is_regex,
				maxResults: input.max_results,
			}),
	}),
] as const;

const toolEntryByName = new Map(toolEntries.map((entry) => [entry.definition.name, entry]));

export const TOOL_DEFINITIONS = toolEntries.map((entry) => entry.definition);

export async function executeToolCall(
	params: ToolCallParams,
	context: ToolExecutionContext
): Promise<ToolExecutionOutcome> {
	const entry = toolEntryByName.get(params.name);
	if (!entry) {
		return invalidToolCall(`Unknown tool: ${params.name}`);
	}
	return runToolEntry(entry, params.arguments, context);
}

async function runToolEntry(
	entry: RuntimeToolEntry,
	rawArguments: unknown,
	context: ToolExecutionContext
): Promise<ToolExecutionOutcome> {
	if (!entry.validate(rawArguments)) {
		return invalidToolCall(entry.invalidArgumentsMessage);
	}

	const absolutePathError = validateAbsolutePaths(rawArguments, entry.absolutePathKeys, entry.absolutePathErrorMessage);
	if (absolutePathError) {
		return invalidToolCall(absolutePathError);
	}

	try {
		return toolResult(await entry.execute(rawArguments, context));
	} catch (err) {
		return toolResult(err instanceof Error ? err.message : String(err), true);
	}
}

function validateAbsolutePaths(
	input: Record<string, unknown>,
	pathKeys?: readonly string[],
	errorMessage?: string
): string | null {
	if (!pathKeys) {
		return null;
	}

	for (const key of pathKeys) {
		const value = input[key];
		if (typeof value !== 'string' || !value.startsWith('/')) {
			return errorMessage ?? 'Tool requires absolute paths';
		}
	}

	return null;
}

function invalidToolCall(message: string): ToolExecutionOutcome {
	return {
		kind: 'error',
		code: -32602,
		message,
	};
}

function toolResult(text: string, isError = false): ToolExecutionOutcome {
	return {
		kind: 'result',
		result: {
			content: [{ type: 'text', text }],
			...(isError ? { isError: true } : {}),
		},
	};
}
