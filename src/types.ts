// ─── MCP Protocol Types ───────────────────────────────────────────────────────

export type McpRequestMethod = 'initialize' | 'notifications/initialized' | 'tools/list' | 'tools/call';

export type McpRequest = {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: McpRequestMethod;
    params?: unknown;
};

export type McpResponse<T = unknown> =
    | {
          jsonrpc: '2.0';
          id: string | number | null;
          result: T;
      }
    | {
          jsonrpc: '2.0';
          id: string | number | null;
          error: McpError;
      };

export type McpError = {
    code: number;
    message: string;
    data?: unknown;
};

// ─── MCP Initialize ───────────────────────────────────────────────────────────

export type InitializeResult = {
    protocolVersion: string;
    capabilities: {
        tools: Record<string, never>;
    };
    serverInfo: {
        name: string;
        version: string;
    };
};

// ─── MCP Tools ────────────────────────────────────────────────────────────────

export type ToolsListResult = {
    tools: ToolDefinition[];
};

export type ToolDefinition = {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
};

export type ToolCallParams = {
    name: string;
    arguments?: unknown;
};

export type ToolCallResult = {
    content: Array<{
        type: 'text';
        text: string;
    }>;
    isError?: boolean;
};

// ─── Tool Input Types ─────────────────────────────────────────────────────────

export type WeaveGandrInput = {
    prompt: string;
    cwd?: string;
    context?: string;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as UnknownRecord;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isIntegerInRange(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function isWeaveGandrInput(value: unknown): value is WeaveGandrInput {
    const v = asRecord(value);
    if (!v) {
        return false;
    }
    if (!isNonEmptyString(v.prompt)) {
        return false;
    }
    if (v.cwd !== undefined && !isNonEmptyString(v.cwd)) {
        return false;
    }
    if (v.context !== undefined && typeof v.context !== 'string') {
        return false;
    }
    return true;
}

// ─── File Tool Input Types ────────────────────────────────────────────────────

export type ReadFileInput = {
    path: string;
};

export function isReadFileInput(value: unknown): value is ReadFileInput {
    const v = asRecord(value);
    return !!v && isNonEmptyString(v.path);
}

export type WriteFileInput = {
    path: string;
    content: string;
};

export function isWriteFileInput(value: unknown): value is WriteFileInput {
    const v = asRecord(value);
    return !!v && isNonEmptyString(v.path) && typeof v.content === 'string';
}

export type ListDirInput = {
    path: string;
};

export function isListDirInput(value: unknown): value is ListDirInput {
    const v = asRecord(value);
    return !!v && isNonEmptyString(v.path);
}

export type DeleteFileInput = {
    path: string;
};

export function isDeleteFileInput(value: unknown): value is DeleteFileInput {
    const v = asRecord(value);
    return !!v && isNonEmptyString(v.path);
}

export type DeleteDirInput = {
    path: string;
};

export function isDeleteDirInput(value: unknown): value is DeleteDirInput {
    const v = asRecord(value);
    return !!v && isNonEmptyString(v.path);
}

export type MoveFileInput = {
    from: string;
    to: string;
};

export function isMoveFileInput(value: unknown): value is MoveFileInput {
    const v = asRecord(value);
    return !!v && isNonEmptyString(v.from) && isNonEmptyString(v.to);
}

export type FileExistsInput = {
    path: string;
};

export function isFileExistsInput(value: unknown): value is FileExistsInput {
    const v = asRecord(value);
    return !!v && isNonEmptyString(v.path);
}

export type CreateDirInput = {
    path: string;
};

export function isCreateDirInput(value: unknown): value is CreateDirInput {
    const v = asRecord(value);
    return !!v && isNonEmptyString(v.path);
}

export type AppendFileInput = {
    path: string;
    content: string;
};

export function isAppendFileInput(value: unknown): value is AppendFileInput {
    const v = asRecord(value);
    return !!v && isNonEmptyString(v.path) && typeof v.content === 'string';
}

export type PatchFileInput = {
    path: string;
    old_str: string;
    new_str: string;
};

export function isPatchFileInput(value: unknown): value is PatchFileInput {
    const v = asRecord(value);
    if (!v) {
        return false;
    }
    return (
        isNonEmptyString(v.path) &&
        typeof v.old_str === 'string' &&
        v.old_str.length > 0 &&
        typeof v.new_str === 'string'
    );
}

export type CopyFileInput = {
    from: string;
    to: string;
};

export function isCopyFileInput(value: unknown): value is CopyFileInput {
    const v = asRecord(value);
    return !!v && isNonEmptyString(v.from) && isNonEmptyString(v.to);
}

export type ReadDirTreeInput = {
    path: string;
    max_depth?: number;
};

export function isReadDirTreeInput(value: unknown): value is ReadDirTreeInput {
    const v = asRecord(value);
    if (!v || !isNonEmptyString(v.path)) return false;
    if (v.max_depth !== undefined && !isIntegerInRange(v.max_depth, 1)) return false;
    return true;
}

export type SearchFilesInput = {
    path: string;
    pattern: string;
};

export function isSearchFilesInput(value: unknown): value is SearchFilesInput {
    const v = asRecord(value);
    return !!v && isNonEmptyString(v.path) && isNonEmptyString(v.pattern);
}

// ─── Claude Stream JSON Types ─────────────────────────────────────────────────

export type ClaudeStreamChunk =
    | { type: 'system'; subtype: string; [key: string]: unknown }
    | { type: 'assistant'; message: { content: Array<{ type: string; text?: string }> } }
    | { type: 'result'; subtype: 'success' | 'error'; result?: string; error?: string }
    | { type: string; [key: string]: unknown };
