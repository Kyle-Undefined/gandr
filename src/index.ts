import { createInterface } from 'readline';
import { runClaudeTask } from './claude';
import { GANDR_VERSION } from './version';
import type {
    McpRequest,
    McpResponse,
    InitializeResult,
    ToolsListResult,
    ToolCallResult,
    ToolCallParams,
} from './types';
import { isWeaveGandrInput } from './types';

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

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_LINE_LENGTH) {
        process.stderr.write('[gandr] Line exceeded max length, ignoring.\n');
        return;
    }
    void handleLine(trimmed);
});

rl.on('close', () => {
    process.exit(0);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown(): void {
    process.exit(0);
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

    const { id, method } = request;

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
                writeError(id, -32601, `Method not found: ${method}`);
        }
    } catch (err) {
        writeError(id, -32603, err instanceof Error ? err.message : String(err));
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

function handleInitialize(id: string | number): void {
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

function handleToolsList(id: string | number): void {
    const result: ToolsListResult = {
        tools: [
            {
                name: 'gandr',
                description:
                    'Weave a task through Gandr to Claude Code running in WSL. Claude Code has full access to the Linux environment, filesystem, shell tools, and all configurations. Use this for any coding, file editing, shell execution, or agentic tasks.',
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
        ],
    };
    writeResult(id, result);
}

async function handleToolCall(id: string | number, params: unknown): Promise<void> {
    if (!isToolCallParams(params)) {
        writeError(id, -32602, 'Invalid tool call params');
        return;
    }

    if (params.name !== 'gandr') {
        writeError(id, -32602, `Unknown tool: ${params.name}`);
        return;
    }

    if (!isWeaveGandrInput(params.arguments)) {
        writeError(id, -32602, 'Invalid arguments for gandr');
        return;
    }

    const task = runClaudeTask(params.arguments);

    try {
        const output = await task;
        const result: ToolCallResult = {
            content: [{ type: 'text', text: output }],
        };
        writeResult(id, result);
    } catch (err) {
        const result: ToolCallResult = {
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
            isError: true,
        };
        writeResult(id, result);
    }
}

// ─── Writers ──────────────────────────────────────────────────────────────────

function writeResult(id: string | number, result: unknown): void {
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
        // Ignore write errors — stdout may be closed during shutdown
    }
}

// ─── Guards ───────────────────────────────────────────────────────────────────

function isMcpRequest(value: unknown): value is McpRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const v = value as Record<string, unknown>;
    return (
        v.jsonrpc === '2.0' &&
        typeof v.method === 'string' &&
        (typeof v.id === 'string' || typeof v.id === 'number' || v.id === undefined)
    );
}

function isToolCallParams(value: unknown): value is ToolCallParams {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const v = value as Record<string, unknown>;
    return typeof v.name === 'string';
}
