import { spawn } from 'child_process';
import { createLineBuffer } from './line-buffer';
import type { WeaveGandrInput, ClaudeStreamChunk } from './types';

const DEFAULT_CWD = process.env.HOME ?? '/';
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_STREAM_LINE_LENGTH = 10 * 1024 * 1024; // 10MB
const MAX_STDERR_LENGTH = 64 * 1024;
const MAX_FALLBACK_STDOUT_LENGTH = 64 * 1024;
const CLAUDE_ARGS = ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];

export async function runClaudeTask(input: WeaveGandrInput): Promise<string> {
    const prompt = buildPrompt(input);
    const cwd = input.cwd ?? DEFAULT_CWD;

    return new Promise((resolve, reject) => {
        let settled = false;

        // Prompt is written to stdin rather than passed as a CLI arg.
        // This avoids ARG_MAX limits, shell escaping issues, and newline
        // handling problems that arise when passing large or multi-line
        // prompts as arguments.
        const proc = spawn('claude', CLAUDE_ARGS, {
            cwd,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const timeout = setTimeout(() => {
            if (!settled) {
                proc.kill('SIGTERM');
                reject(new Error('claude timed out after 10 minutes'));
                settled = true;
            }
        }, CLAUDE_TIMEOUT_MS);

        proc.stdin.on('error', (err) => {
            // Ignore EPIPE - the process likely exited before reading all input
            if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
                if (!settled) {
                    reject(new Error(`Failed to write to claude stdin: ${err.message}`));
                    settled = true;
                }
            }
        });

        let finalResult = '';
        let finalError = '';
        let errorOutput = '';
        let fallbackOutput = '';
        const stdoutBuffer = createLineBuffer(MAX_STREAM_LINE_LENGTH, {
            onLine: handleStreamLine,
            onLineTooLong: () => {
                finalError = 'claude emitted a stream line that exceeded the maximum supported length';
            },
        });

        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk: string) => {
            stdoutBuffer.push(chunk);
        });

        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (chunk: string) => {
            errorOutput = appendCapped(errorOutput, chunk, MAX_STDERR_LENGTH);
        });

        proc.stdin.end(prompt, 'utf8');

        proc.on('close', (code, signal) => {
            clearTimeout(timeout);
            if (settled) return;

            stdoutBuffer.flush();

            if (code !== 0) {
                const message =
                    errorOutput.trim() ||
                    finalError ||
                    (signal ? `claude exited due to signal ${signal}` : `claude exited with code ${String(code)}`);
                settled = true;
                reject(new Error(message));
                return;
            }
            if (finalError) {
                settled = true;
                reject(new Error(finalError));
                return;
            }
            settled = true;
            resolve(finalResult !== '' ? finalResult : fallbackOutput.trim());
        });

        proc.on('error', (err) => {
            clearTimeout(timeout);
            if (!settled) {
                settled = true;
                reject(new Error(`Failed to spawn claude: ${err.message}`));
            }
        });

        function handleStreamLine(line: string): void {
            if (!line) return;

            try {
                const parsed = JSON.parse(line) as ClaudeStreamChunk;
                const result = extractResult(parsed);
                if (result?.kind === 'success') {
                    finalResult = result.text;
                }
                if (result?.kind === 'error') {
                    finalError = result.text;
                }
            } catch {
                fallbackOutput = appendCapped(fallbackOutput, `${line}\n`, MAX_FALLBACK_STDOUT_LENGTH);
            }
        }
    });
}

function buildPrompt(input: WeaveGandrInput): string {
    if (!input.context) {
        return input.prompt;
    }
    return `Context from conversation:\n---\n${input.context}\n---\n\nTask: ${input.prompt}`;
}

const TRUNCATION_MARKER = '\n[gandr] output truncated.';

function appendCapped(current: string, nextChunk: string, maxLength: number): string {
    if (current.length >= maxLength) {
        return current;
    }

    const remainingLength = maxLength - current.length;
    if (nextChunk.length <= remainingLength) {
        return current + nextChunk;
    }

    const effectiveRemaining = Math.max(0, remainingLength - TRUNCATION_MARKER.length);
    return `${current}${nextChunk.slice(0, effectiveRemaining)}${TRUNCATION_MARKER}`;
}

function extractResult(chunk: ClaudeStreamChunk): { kind: 'success' | 'error'; text: string } | null {
    if (chunk.type === 'result') {
        if (chunk.subtype === 'success' && typeof chunk.result === 'string') {
            return { kind: 'success', text: chunk.result };
        }
        if (chunk.subtype === 'error' && typeof chunk.error === 'string') {
            return { kind: 'error', text: chunk.error };
        }
    }
    return null;
}
