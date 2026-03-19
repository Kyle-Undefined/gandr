import { mkdirSync, createWriteStream, type WriteStream } from 'fs';
import { dirname, join } from 'path';
import type { LogLevel } from './runtime';

export type Logger = {
	error: (message: string) => void;
	debug: (message: string) => void;
	close: () => Promise<void>;
};

export type LoggerOptions = {
	logToFile?: boolean;
};

export function createLogger(logLevel: LogLevel, options: LoggerOptions = {}): Logger {
	const fileStream = options.logToFile ? createFileLogStream() : null;

	return {
		error: (message: string) => {
			writeLog('error', message, fileStream);
		},
		debug: (message: string) => {
			if (logLevel !== 'debug') {
				return;
			}
			writeLog('debug', message, fileStream);
		},
		close: () => closeFileLogStream(fileStream),
	};
}

type FileLogStreamState = {
	stream: WriteStream;
	writable: boolean;
	closePromise: Promise<void> | null;
};

function writeLog(level: LogLevel, message: string, fileStream: FileLogStreamState | null): void {
	const line = `[gandr] [${level}] ${message}\n`;

	writeToStderr(line);

	if (!fileStream || !fileStream.writable || fileStream.stream.destroyed) {
		return;
	}

	try {
		fileStream.stream.write(line);
	} catch {
		fileStream.writable = false;
	}
}

function createFileLogStream(): FileLogStreamState | null {
	try {
		const logPath = resolveLogFilePath();
		mkdirSync(dirname(logPath), { recursive: true });
		const stream = createWriteStream(logPath, { flags: 'a' });
		const state: FileLogStreamState = {
			stream,
			writable: true,
			closePromise: null,
		};
		stream.on('error', (err) => {
			disableFileLogging(
				state,
				`File logging disabled after write failure: ${err instanceof Error ? err.message : String(err)}`
			);
		});
		return state;
	} catch (err) {
		writeToStderr(
			`[gandr] [error] Failed to initialize file logging: ${err instanceof Error ? err.message : String(err)}\n`
		);
		return null;
	}
}

function disableFileLogging(state: FileLogStreamState, message: string): void {
	if (!state.writable) {
		return;
	}

	state.writable = false;
	writeToStderr(`[gandr] [error] ${message}\n`);

	if (!state.stream.destroyed) {
		try {
			state.stream.destroy();
		} catch {
			// Ignore cleanup failures after stream errors.
		}
	}
}

function closeFileLogStream(state: FileLogStreamState | null): Promise<void> {
	if (!state) {
		return Promise.resolve();
	}

	if (state.closePromise) {
		return state.closePromise;
	}

	state.writable = false;

	if (state.stream.destroyed || state.stream.writableEnded) {
		state.closePromise = Promise.resolve();
		return state.closePromise;
	}

	state.closePromise = new Promise((resolve) => {
		let settled = false;
		const settle = (): void => {
			if (settled) {
				return;
			}
			settled = true;
			state.stream.off('close', settle);
			state.stream.off('finish', settle);
			state.stream.off('error', settle);
			resolve();
		};

		state.stream.once('close', settle);
		state.stream.once('finish', settle);
		state.stream.once('error', settle);

		try {
			state.stream.end(() => {
				settle();
			});
		} catch {
			try {
				state.stream.destroy();
			} catch {
				// Ignore cleanup failures during shutdown.
			}
			settle();
		}
	});

	return state.closePromise;
}

function writeToStderr(line: string): void {
	try {
		process.stderr.write(line);
	} catch {
		// Ignore write failures during shutdown.
	}
}

export function resolveLogFilePath(env = process.env): string {
	const stateHome =
		typeof env.XDG_STATE_HOME === 'string' && env.XDG_STATE_HOME.trim().length > 0
			? env.XDG_STATE_HOME.trim()
			: resolveDefaultStateHome(env);

	return join(stateHome, 'gandr', 'gandr.log');
}

function resolveDefaultStateHome(env: NodeJS.ProcessEnv): string {
	if (typeof env.HOME === 'string' && env.HOME.trim().length > 0) {
		return join(env.HOME.trim(), '.local', 'state');
	}

	throw new Error('HOME is not set and XDG_STATE_HOME is not configured');
}
