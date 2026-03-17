// ─── MCP Protocol Types ───────────────────────────────────────────────────────

export type McpRequestMethod = 'initialize' | 'notifications/initialized' | 'tools/list' | 'tools/call';

export type McpRequest = {
    jsonrpc: '2.0';
    id?: string | number;
    method: McpRequestMethod;
    params?: unknown;
};

export type McpResponse<T = unknown> =
    | {
          jsonrpc: '2.0';
          id: string | number;
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
    arguments: unknown;
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

export function isWeaveGandrInput(value: unknown): value is WeaveGandrInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const v = value as Record<string, unknown>;
    if (typeof v.prompt !== 'string' || v.prompt.trim().length === 0) {
        return false;
    }
    if (v.cwd !== undefined && (typeof v.cwd !== 'string' || v.cwd.trim().length === 0)) {
        return false;
    }
    if (v.context !== undefined && typeof v.context !== 'string') {
        return false;
    }
    return true;
}

// ─── Claude Stream JSON Types ─────────────────────────────────────────────────

export type ClaudeStreamChunk =
    | { type: 'system'; subtype: string; [key: string]: unknown }
    | { type: 'assistant'; message: { content: Array<{ type: string; text?: string }> } }
    | { type: 'result'; subtype: 'success' | 'error'; result?: string; error?: string }
    | { type: string; [key: string]: unknown };
