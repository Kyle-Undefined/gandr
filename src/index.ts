import { executeToolCall, TOOL_DEFINITIONS } from './tools';
import { GANDR_VERSION } from './version';
import { createLineBuffer } from './line-buffer';
import type { McpRequest, McpResponse, InitializeResult, ToolsListResult, ToolCallParams } from './types';

// ─── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--version')) {
	process.stdout.write(`${GANDR_VERSION}\n`);
	process.exit(0);
}

if (args.includes('--healthcheck')) {
	process.stdout.write('ok\n');
	process.exit(0);
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = '2025-11-25';
const MAX_LINE_LENGTH = 10 * 1024 * 1024; // 10MB
let processingQueue = Promise.resolve();
let shutdownPromise: Promise<void> | null = null;

const lineBuffer = createLineBuffer(MAX_LINE_LENGTH, {
	onLine: (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		processingQueue = processingQueue
			.then(() => handleLine(trimmed))
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				process.stderr.write(`[gandr] Unhandled line processing error: ${message}\n`);
			});
	},
	onLineTooLong: () => {
		process.stderr.write('[gandr] Line exceeded max length, ignoring.\n');
	},
});

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
	lineBuffer.push(chunk);
});

process.stdin.on('end', () => {
	void finalizeServer(true);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown(): void {
	void finalizeServer(false);
}

function finalizeServer(flushPendingLine: boolean): Promise<void> {
	if (!shutdownPromise) {
		shutdownPromise = (async () => {
			if (flushPendingLine) {
				lineBuffer.flush();
			}

			await processingQueue.catch(() => {
				// Queue errors are already reported when they happen.
			});
		})().finally(() => {
			process.exit(0);
		});
	}

	return shutdownPromise;
}

// ─── Line Handler ─────────────────────────────────────────────────────────────

async function handleLine(line: string): Promise<void> {
	let request: unknown;
	try {
		request = JSON.parse(line);
	} catch {
		writeError(null, -32700, 'Parse error');
		return;
	}

	if (!isMcpRequest(request)) {
		writeError(null, -32600, 'Invalid request');
		return;
	}

	const { id: rawId, method } = request;
	const id = rawId ?? null;

	try {
		switch (method) {
			case 'initialize':
				handleInitialize(id);
				break;
			case 'notifications/initialized':
				break;
			case 'tools/list':
				handleToolsList(id);
				break;
			case 'tools/call':
				await handleToolCall(id, request.params);
				break;
			default:
				if (id !== null) {
					writeError(id, -32601, `Method not found: ${method}`);
				}
		}
	} catch (err) {
		if (id !== null) {
			writeError(id, -32603, err instanceof Error ? err.message : String(err));
		}
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

function handleInitialize(id: string | number | null): void {
	const result: InitializeResult = {
		protocolVersion: MCP_PROTOCOL_VERSION,
		capabilities: {
			tools: {},
		},
		serverInfo: {
			name: 'gandr',
			version: GANDR_VERSION,
		},
	};
	writeResult(id, result);
}

function handleToolsList(id: string | number | null): void {
	const result: ToolsListResult = {
		tools: TOOL_DEFINITIONS,
	};
	writeResult(id, result);
}

async function handleToolCall(id: string | number | null, params: unknown): Promise<void> {
	if (!isToolCallParams(params)) {
		if (id !== null) {
			writeError(id, -32602, 'Invalid tool call params');
		}
		return;
	}

	const outcome = await executeToolCall(params);
	if (outcome.kind === 'error') {
		if (id !== null) {
			writeError(id, outcome.code, outcome.message);
		}
		return;
	}

	if (id === null) {
		return;
	}

	writeResult(id, outcome.result);
}

// ─── Writers ──────────────────────────────────────────────────────────────────

function writeResult(id: string | number | null, result: unknown): void {
	const response: McpResponse = { jsonrpc: '2.0', id, result };
	writeLine(response);
}

function writeError(id: string | number | null, code: number, message: string): void {
	const response: McpResponse = {
		jsonrpc: '2.0',
		id,
		error: { code, message },
	};
	writeLine(response);
}

function writeLine(value: unknown): void {
	try {
		process.stdout.write(`${JSON.stringify(value)}\n`);
	} catch {
		// Ignore write errors - stdout may be closed during shutdown
	}
}

// ─── Guards ───────────────────────────────────────────────────────────────────

function isMcpRequest(value: unknown): value is McpRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const v = value as Record<string, unknown>;
	return (
		v.jsonrpc === '2.0' &&
		typeof v.method === 'string' &&
		(typeof v.id === 'string' || typeof v.id === 'number' || v.id === null || v.id === undefined)
	);
}

function isToolCallParams(value: unknown): value is ToolCallParams {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const v = value as Record<string, unknown>;
	return typeof v.name === 'string';
}
