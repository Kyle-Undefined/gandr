import { spawn } from 'child_process';
import type { WeaveGandrInput, ClaudeStreamChunk } from './types';

const DEFAULT_CWD = process.env.HOME ?? '/';

export async function runClaudeTask(input: WeaveGandrInput): Promise<string> {
    const prompt = buildPrompt(input);
    const cwd = input.cwd ?? DEFAULT_CWD;

    return new Promise((resolve, reject) => {
        let settled = false;

        // Prompt is written to stdin rather than passed as a CLI arg.
        // This avoids ARG_MAX limits, shell escaping issues, and newline
        // handling problems that arise when passing large or multi-line
        // prompts as arguments.
        const proc = spawn(
            'claude',
            ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
            {
                cwd,
                env: process.env,
                stdio: ['pipe', 'pipe', 'pipe'],
            }
        );

        const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
        const timeout = setTimeout(() => {
            if (!settled) {
                proc.kill('SIGTERM');
                reject(new Error('claude timed out after 10 minutes'));
                settled = true;
            }
        }, TIMEOUT_MS);

        proc.stdin.on('error', (err) => {
            // Ignore EPIPE - the process likely exited before reading all input
            if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
                if (!settled) {
                    reject(new Error(`Failed to write to claude stdin: ${err.message}`));
                    settled = true;
                }
            }
        });

        // Write prompt to stdin and close it so claude knows input is complete
        proc.stdin.write(prompt, 'utf8');
        proc.stdin.end();

        let stdoutBuffer = '';
        let finalResult = '';
        let finalError = '';
        let errorOutput = '';

        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk: string) => {
            stdoutBuffer += chunk;

            while (true) {
                const idx = stdoutBuffer.indexOf('\n');
                if (idx < 0) break;

                const line = stdoutBuffer.slice(0, idx).trim();
                stdoutBuffer = stdoutBuffer.slice(idx + 1);
                handleStreamLine(line);
            }
        });

        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (chunk: string) => {
            errorOutput += chunk;
        });

        proc.on('close', (code, signal) => {
            clearTimeout(timeout);
            if (settled) return;

            const trailingLine = stdoutBuffer.trim();
            if (trailingLine) {
                handleStreamLine(trailingLine);
                if (finalResult || finalError) {
                    stdoutBuffer = '';
                }
            }

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
            resolve(finalResult || stdoutBuffer.trim());
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
                // Non-JSON line — ignore
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
