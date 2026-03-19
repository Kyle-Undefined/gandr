import { spawn } from 'child_process';
import { createLineBuffer } from './line-buffer';
import type { WeaveGandrInput, ClaudeStreamChunk } from './types';
import type { Logger } from './logger';

const DEFAULT_CWD = process.env.HOME ?? '/';
const MAX_STREAM_LINE_LENGTH = 10 * 1024 * 1024; // 10MB
const MAX_STDERR_LENGTH = 64 * 1024;
const MAX_FALLBACK_STDOUT_LENGTH = 64 * 1024;
const FORCE_KILL_GRACE_MS = 10 * 1000;
const CLAUDE_ARGS = ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];

export type ClaudeTaskRuntime = {
	logger: Logger;
	claudeTimeoutMs: number | null;
};

export async function runClaudeTask(input: WeaveGandrInput, runtime: ClaudeTaskRuntime): Promise<string> {
	const prompt = buildPrompt(input);
	const cwd = input.cwd ?? DEFAULT_CWD;

	return new Promise((resolve, reject) => {
		let settled = false;
		let timedOut = false;
		let timeoutMessage = '';
		let stderrWasTruncated = false;
		let fallbackStdoutWasTruncated = false;
		let forceKillTimeout: NodeJS.Timeout | null = null;

		// Prompt is written to stdin rather than passed as a CLI arg.
		// This avoids ARG_MAX limits, shell escaping issues, and newline
		// handling problems that arise when passing large or multi-line
		// prompts as arguments.
		const proc = spawn('claude', CLAUDE_ARGS, {
			cwd,
			env: process.env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		runtime.logger.debug(`Spawning claude in cwd ${cwd}`);

		const timeout =
			runtime.claudeTimeoutMs === null
				? null
				: setTimeout(() => {
						if (settled || timedOut) {
							return;
						}
						timedOut = true;
						timeoutMessage = `claude timed out after ${runtime.claudeTimeoutMs}ms`;
						runtime.logger.error(timeoutMessage);
						runtime.logger.debug('Sending SIGTERM to claude after timeout');
						try {
							proc.kill('SIGTERM');
						} catch (err) {
							runtime.logger.debug(
								`Failed to send SIGTERM to claude: ${err instanceof Error ? err.message : String(err)}`
							);
						}

						forceKillTimeout = setTimeout(() => {
							if (settled) {
								return;
							}
							runtime.logger.debug('claude still running after SIGTERM grace period, sending SIGKILL');
							try {
								proc.kill('SIGKILL');
							} catch (err) {
								runtime.logger.debug(
									`Failed to send SIGKILL to claude: ${err instanceof Error ? err.message : String(err)}`
								);
							}
						}, FORCE_KILL_GRACE_MS);
					}, runtime.claudeTimeoutMs);

		proc.on('spawn', () => {
			runtime.logger.debug('claude process spawned');
		});

		proc.stdin.on('error', (err) => {
			// Ignore EPIPE - the process likely exited before reading all input
			if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
				if (!settled) {
					clearTimer(timeout);
					runtime.logger.error(`Failed to write to claude stdin: ${err.message}`);
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
			const next = appendCapped(errorOutput, chunk, MAX_STDERR_LENGTH);
			if (next.truncated && !stderrWasTruncated) {
				stderrWasTruncated = true;
				runtime.logger.debug('claude stderr output truncated');
			}
			errorOutput = next.text;
		});

		proc.stdin.end(prompt, 'utf8');

		proc.on('close', (code, signal) => {
			clearTimer(timeout);
			if (forceKillTimeout) {
				clearTimeout(forceKillTimeout);
				forceKillTimeout = null;
			}
			if (settled) return;

			stdoutBuffer.flush();
			runtime.logger.debug(`claude process exited with code ${String(code)}${signal ? ` and signal ${signal}` : ''}`);

			if (timedOut) {
				settled = true;
				reject(new Error(timeoutMessage));
				return;
			}
			if (code !== 0) {
				const message =
					errorOutput.trim() ||
					finalError ||
					(signal ? `claude exited due to signal ${signal}` : `claude exited with code ${String(code)}`);
				runtime.logger.error(message);
				settled = true;
				reject(new Error(message));
				return;
			}
			if (finalError) {
				runtime.logger.error(finalError);
				settled = true;
				reject(new Error(finalError));
				return;
			}
			settled = true;
			resolve(finalResult !== '' ? finalResult : fallbackOutput.trim());
		});

		proc.on('error', (err) => {
			clearTimer(timeout);
			if (forceKillTimeout) {
				clearTimeout(forceKillTimeout);
				forceKillTimeout = null;
			}
			if (!settled) {
				settled = true;
				runtime.logger.error(`Failed to spawn claude: ${err.message}`);
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
				const next = appendCapped(fallbackOutput, `${line}\n`, MAX_FALLBACK_STDOUT_LENGTH);
				if (next.truncated && !fallbackStdoutWasTruncated) {
					fallbackStdoutWasTruncated = true;
					runtime.logger.debug('claude fallback stdout output truncated');
				}
				fallbackOutput = next.text;
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

function appendCapped(current: string, nextChunk: string, maxLength: number): { text: string; truncated: boolean } {
	if (current.length >= maxLength) {
		return { text: current, truncated: true };
	}

	const remainingLength = maxLength - current.length;
	if (nextChunk.length <= remainingLength) {
		return { text: current + nextChunk, truncated: false };
	}

	const marker = TRUNCATION_MARKER.slice(0, Math.min(TRUNCATION_MARKER.length, remainingLength));
	const effectiveRemaining = Math.max(0, remainingLength - marker.length);
	return {
		text: `${current}${nextChunk.slice(0, effectiveRemaining)}${marker}`,
		truncated: true,
	};
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

function clearTimer(timeout: NodeJS.Timeout | null): void {
	if (timeout) {
		clearTimeout(timeout);
	}
}
