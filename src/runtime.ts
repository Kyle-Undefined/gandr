export type LogLevel = 'error' | 'debug';

export type RuntimeCommand = 'server' | 'version' | 'healthcheck' | 'doctor';

export type RuntimeConfig = {
	command: RuntimeCommand;
	logLevel: LogLevel;
	logToFile: boolean;
	claudeTimeoutMs: number | null;
};

export function parseRuntimeArgs(argv: string[]): RuntimeConfig {
	let command: RuntimeCommand = 'server';
	let logLevel: LogLevel = 'error';
	let logToFile = false;
	let claudeTimeoutMs: number | null = null;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];

		if (arg === '--version') {
			command = setCommand(command, 'version');
			continue;
		}

		if (arg === '--healthcheck') {
			command = setCommand(command, 'healthcheck');
			continue;
		}

		if (arg === '--doctor') {
			command = setCommand(command, 'doctor');
			continue;
		}

		if (arg === '--log-level' || arg.startsWith('--log-level=')) {
			const value = readOptionValue(arg, argv, i, '--log-level');
			logLevel = parseLogLevel(value);
			logToFile = true;
			if (arg === '--log-level') {
				i += 1;
			}
			continue;
		}

		if (arg === '--claude-timeout-ms' || arg.startsWith('--claude-timeout-ms=')) {
			const value = readOptionValue(arg, argv, i, '--claude-timeout-ms');
			claudeTimeoutMs = parseClaudeTimeoutMs(value);
			if (arg === '--claude-timeout-ms') {
				i += 1;
			}
			continue;
		}

		throw new Error(`Unknown argument: ${arg}`);
	}

	return {
		command,
		logLevel,
		logToFile,
		claudeTimeoutMs,
	};
}

function setCommand(current: RuntimeCommand, next: RuntimeCommand): RuntimeCommand {
	if (current !== 'server' && current !== next) {
		throw new Error(`Cannot combine --${current} with --${next}`);
	}
	return next;
}

function readOptionValue(arg: string, argv: string[], index: number, name: string): string {
	if (arg.startsWith(`${name}=`)) {
		const value = arg.slice(name.length + 1);
		if (value.length === 0) {
			throw new Error(`${name} requires a value`);
		}
		return value;
	}

	const next = argv[index + 1];
	if (!next || next.startsWith('-')) {
		throw new Error(`${name} requires a value`);
	}
	return next;
}

function parseLogLevel(value: string): LogLevel {
	if (value === 'error' || value === 'debug') {
		return value;
	}
	throw new Error(`Unsupported log level: ${value}. Use error or debug.`);
}

function parseClaudeTimeoutMs(value: string): number {
	if (!/^\d+$/.test(value)) {
		throw new Error('--claude-timeout-ms must be a positive integer');
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error('--claude-timeout-ms must be a positive integer');
	}

	return parsed;
}
