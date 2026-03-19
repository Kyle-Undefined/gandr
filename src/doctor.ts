import { spawnSync } from 'child_process';
import type { SpawnSyncReturns } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

type DoctorStatus = 'PASS' | 'WARN' | 'FAIL';

type DoctorCheck = {
	status: DoctorStatus;
	label: string;
	detail: string;
};

type ClaudePathCheck = {
	status: DoctorStatus;
	detail: string;
	ok: boolean;
};

type AuthStatusJson = {
	loggedIn?: unknown;
	authMethod?: unknown;
};

export function runDoctor(): number {
	const checks: DoctorCheck[] = [];

	checks.push({
		status: 'WARN',
		label: 'Claude Desktop config',
		detail: 'manual step required; verify %APPDATA%\\Claude\\claude_desktop_config.json on Windows',
	});

	const home = process.env.HOME;
	const homeCheck = checkHome(home);
	checks.push(homeCheck);

	const claudePathCheck = checkClaudePath();
	checks.push({
		status: claudePathCheck.status,
		label: 'claude PATH',
		detail: claudePathCheck.detail,
	});

	checks.push(checkClaudeVersion());
	checks.push(checkClaudeAuthStatus());
	checks.push(checkInstallConsistency(home));
	checks.push(checkWslDistroName());
	checks.push(checkShellInitFiles(home, claudePathCheck.ok));

	for (const check of checks) {
		process.stdout.write(`${check.status.padEnd(4)} ${check.label}: ${check.detail}\n`);
	}

	const failureCount = checks.filter((check) => check.status === 'FAIL').length;
	const warningCount = checks.filter((check) => check.status === 'WARN').length;
	const summaryStatus: DoctorStatus = failureCount > 0 ? 'FAIL' : 'PASS';
	process.stdout.write(
		`${summaryStatus} Summary: ${checks.length} checks, ${failureCount} failure${pluralize(failureCount)}, ${warningCount} warning${pluralize(warningCount)}\n`
	);

	return failureCount > 0 ? 1 : 0;
}

function checkHome(home: string | undefined): DoctorCheck {
	if (!home || home.trim().length === 0) {
		return {
			status: 'FAIL',
			label: 'HOME',
			detail: 'HOME is not set',
		};
	}

	try {
		const stats = statSync(home);
		if (!stats.isDirectory()) {
			return {
				status: 'FAIL',
				label: 'HOME',
				detail: `HOME exists but is not a directory: ${home}`,
			};
		}
	} catch (err) {
		return {
			status: 'FAIL',
			label: 'HOME',
			detail: `HOME is not usable: ${formatError(err)}`,
		};
	}

	return {
		status: 'PASS',
		label: 'HOME',
		detail: home,
	};
}

function checkClaudePath(): ClaudePathCheck {
	const resolved = resolveExecutableOnPath('claude', process.env.PATH);
	if (!resolved) {
		return {
			status: 'FAIL',
			detail: 'claude is not on PATH',
			ok: false,
		};
	}

	return {
		status: 'PASS',
		detail: resolved,
		ok: true,
	};
}

function checkClaudeVersion(): DoctorCheck {
	const result = spawnSync('claude', ['--version'], {
		encoding: 'utf8',
		env: process.env,
		timeout: 30000,
	});

	if (result.status !== 0) {
		return {
			status: 'FAIL',
			label: 'claude version',
			detail: extractCommandFailure(result, 'claude --version failed'),
		};
	}

	const version = firstNonEmptyLine(result.stdout) ?? 'claude --version succeeded';
	return {
		status: 'PASS',
		label: 'claude version',
		detail: version,
	};
}

function checkClaudeAuthStatus(): DoctorCheck {
	const result = spawnSync('claude', ['auth', 'status', '--json'], {
		encoding: 'utf8',
		env: process.env,
	});

	if (result.status !== 0) {
		return {
			status: 'FAIL',
			label: 'claude auth',
			detail: extractCommandFailure(result, 'claude auth status --json failed'),
		};
	}

	let parsed: AuthStatusJson;
	try {
		parsed = JSON.parse(result.stdout) as AuthStatusJson;
	} catch (err) {
		return {
			status: 'FAIL',
			label: 'claude auth',
			detail: `invalid JSON from claude auth status --json: ${formatError(err)}`,
		};
	}

	if (parsed.loggedIn !== true) {
		return {
			status: 'FAIL',
			label: 'claude auth',
			detail: 'not logged in',
		};
	}

	const authMethod =
		typeof parsed.authMethod === 'string' && parsed.authMethod.trim().length > 0 ? parsed.authMethod.trim() : null;
	return {
		status: 'PASS',
		label: 'claude auth',
		detail: authMethod ? `logged in via ${authMethod}` : 'logged in',
	};
}

function checkInstallConsistency(home: string | undefined): DoctorCheck {
	if (!home || home.trim().length === 0) {
		return {
			status: 'FAIL',
			label: 'install paths',
			detail: 'HOME is required to inspect standard install paths',
		};
	}

	const binPath = join(home, '.local', 'bin', 'gandr');
	const weaverPath = join(home, '.local', 'bin', 'gandr-weaver');
	const hasBinary = existsSync(binPath);
	const hasWeaver = existsSync(weaverPath);

	if (!hasBinary && !hasWeaver) {
		return {
			status: 'PASS',
			label: 'install paths',
			detail: 'no standard ~/.local/bin installation detected',
		};
	}

	if (hasWeaver && !hasBinary) {
		return {
			status: 'FAIL',
			label: 'install paths',
			detail: `wrapper exists without installed binary: ${weaverPath}`,
		};
	}

	if (hasBinary) {
		const binaryExecutable = isExecutableFile(binPath);
		if (!binaryExecutable.ok) {
			return {
				status: 'FAIL',
				label: 'install paths',
				detail: binaryExecutable.detail,
			};
		}
	}

	if (!hasWeaver) {
		return {
			status: 'WARN',
			label: 'install paths',
			detail: `installed binary found without standard wrapper: ${binPath}`,
		};
	}

	const weaverExecutable = isExecutableFile(weaverPath);
	if (!weaverExecutable.ok) {
		return {
			status: 'FAIL',
			label: 'install paths',
			detail: weaverExecutable.detail,
		};
	}

	let content = '';
	try {
		content = readFileSync(weaverPath, 'utf8');
	} catch (err) {
		return {
			status: 'FAIL',
			label: 'install paths',
			detail: `failed to read wrapper: ${formatError(err)}`,
		};
	}

	if (!content.includes('$HOME/.local/bin/gandr')) {
		return {
			status: 'FAIL',
			label: 'install paths',
			detail: `wrapper does not reference standard binary path: ${weaverPath}`,
		};
	}

	return {
		status: 'PASS',
		label: 'install paths',
		detail: `standard binary and wrapper are consistent (${binPath}, ${weaverPath})`,
	};
}

function checkWslDistroName(): DoctorCheck {
	const value = process.env.WSL_DISTRO_NAME;
	if (!isLikelyWsl()) {
		return {
			status: 'PASS',
			label: 'WSL_DISTRO_NAME',
			detail: 'not running in WSL',
		};
	}

	if (!value || value.trim().length === 0) {
		return {
			status: 'WARN',
			label: 'WSL_DISTRO_NAME',
			detail: 'not set',
		};
	}

	return {
		status: 'PASS',
		label: 'WSL_DISTRO_NAME',
		detail: value,
	};
}

function checkShellInitFiles(home: string | undefined, claudeOnPath: boolean): DoctorCheck {
	if (!home || home.trim().length === 0) {
		return {
			status: 'WARN',
			label: 'shell init files',
			detail: 'HOME unavailable; skipped ~/.profile and ~/.bashrc check',
		};
	}

	const profilePath = join(home, '.profile');
	const bashrcPath = join(home, '.bashrc');
	const missing: string[] = [];

	if (!existsSync(profilePath)) {
		missing.push('~/.profile');
	}
	if (!existsSync(bashrcPath)) {
		missing.push('~/.bashrc');
	}

	if (missing.length === 0) {
		return {
			status: 'PASS',
			label: 'shell init files',
			detail: 'found ~/.profile and ~/.bashrc',
		};
	}

	return {
		status: claudeOnPath ? 'PASS' : 'WARN',
		label: 'shell init files',
		detail: claudeOnPath
			? `missing ${missing.join(' and ')}, but claude already resolves on PATH`
			: `missing ${missing.join(' and ')}`,
	};
}

function isExecutableFile(path: string): { ok: boolean; detail: string } {
	try {
		const stats = statSync(path);
		if (!stats.isFile()) {
			return {
				ok: false,
				detail: `${path} exists but is not a file`,
			};
		}

		if ((stats.mode & 0o111) === 0) {
			return {
				ok: false,
				detail: `${path} is not executable`,
			};
		}
	} catch (err) {
		return {
			ok: false,
			detail: `failed to inspect ${path}: ${formatError(err)}`,
		};
	}

	return {
		ok: true,
		detail: `${path} is executable`,
	};
}

function extractCommandFailure(result: SpawnSyncReturns<string>, fallbackMessage: string): string {
	if (result.error) {
		return result.error.message;
	}

	const stderr = firstNonEmptyLine(result.stderr);
	if (stderr) {
		return stderr;
	}

	return result.signal ? `${fallbackMessage} (signal ${result.signal})` : fallbackMessage;
}

function firstNonEmptyLine(value: string): string | null {
	for (const line of value.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	return null;
}

function formatError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function pluralize(value: number): string {
	return value === 1 ? '' : 's';
}

function isLikelyWsl(): boolean {
	if (process.platform !== 'linux') {
		return false;
	}

	return existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') || existsSync('/run/WSL');
}

function resolveExecutableOnPath(command: string, pathValue: string | undefined): string | null {
	if (!pathValue || pathValue.trim().length === 0) {
		return null;
	}

	for (const entry of pathValue.split(':')) {
		if (!entry) {
			continue;
		}

		const candidate = join(entry, command);
		const executable = isExecutableFile(candidate);
		if (executable.ok) {
			return candidate;
		}
	}

	return null;
}
