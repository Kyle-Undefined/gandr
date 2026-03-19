import { executeToolCall, TOOL_DEFINITIONS } from './tools';
import { GANDR_VERSION } from './version';
import { createLineBuffer } from './line-buffer';
import { parseRuntimeArgs } from './runtime';
import { createLogger, type Logger } from './logger';
import { runDoctor } from './doctor';
import type { InitializeResult, McpRequest, McpResponse, ToolCallParams, ToolsListResult } from './types';

// ─── Args ─────────────────────────────────────────────────────────────────────

void main().catch((err: unknown) => {
	try {
		process.stderr.write(`[gandr] ${err instanceof Error ? err.message : String(err)}\n`);
	} catch {
		// Ignore stderr failures during fatal shutdown.
	}
	process.exit(1);
});

async function main(): Promise<void> {
	let runtime;
	try {
		runtime = parseRuntimeArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`[gandr] ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
		return;
	}

	switch (runtime.command) {
		case 'version':
			process.stdout.write(`${GANDR_VERSION}\n`);
			process.exit(0);
			return;
		case 'healthcheck':
			process.stdout.write('ok\n');
			process.exit(0);
			return;
		case 'doctor':
			process.exit(runDoctor());
			return;
		case 'server': {
			const logger = createLogger(runtime.logLevel, {
				logToFile: runtime.logToFile,
			});
			try {
				startServer(logger, runtime.claudeTimeoutMs);
			} catch (err) {
				await logger.close();
				throw err;
			}
			return;
		}
	}
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

function startServer(logger: Logger, claudeTimeoutMs: number | null): void {
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
					logger.error(`Unhandled line processing error: ${message}`);
				});
		},
		onLineTooLong: () => {
			logger.error('Line exceeded max length, ignoring.');
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

				await logger.close();
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
			logger.error('Failed to parse incoming JSON line');
			writeError(null, -32700, 'Parse error');
			return;
		}

		if (!isMcpRequest(request)) {
			logger.error('Received invalid MCP request');
			writeError(null, -32600, 'Invalid request');
			return;
		}

		const { id: rawId, method } = request;
		const id = rawId ?? null;
		logger.debug(`Received MCP request: ${method}`);

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
				const message = err instanceof Error ? err.message : String(err);
				logger.error(message);
				writeError(id, -32603, message);
			}
		}
	}

	// ─── Handlers ─────────────────────────────────────────────────────────────────

	function handleInitialize(id: string | number | null): void {
		if (id === null) return;
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
		if (id === null) return;
		const result: ToolsListResult = {
			tools: TOOL_DEFINITIONS,
		};
		writeResult(id, result);
	}

	async function handleToolCall(id: string | number | null, params: unknown): Promise<void> {
		if (!isToolCallParams(params)) {
			if (id !== null) {
				logger.error('Invalid tool call params');
				writeError(id, -32602, 'Invalid tool call params');
			}
			return;
		}

		logger.debug(`Received tool call: ${params.name}`);

		const outcome = await executeToolCall(params, {
			logger,
			claudeTimeoutMs,
		});
		if (outcome.kind === 'error') {
			if (id !== null) {
				writeError(id, outcome.code, outcome.message);
			}
			return;
		}

		if (id === null) {
			return;
		}

		if (outcome.result.isError && params.name !== 'gandr') {
			const text = outcome.result.content[0]?.text ?? 'tool returned an error';
			logger.error(`Tool ${params.name} failed: ${text}`);
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
