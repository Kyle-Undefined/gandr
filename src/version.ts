import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

declare const __GANDR_VERSION__: string | undefined;

function resolveVersion(): string {
    if (typeof __GANDR_VERSION__ === 'string' && __GANDR_VERSION__.trim().length > 0) {
        return __GANDR_VERSION__.trim();
    }

    try {
        const dir = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));
        const candidates = [join(dir, '..', 'package.json'), join(dir, 'package.json')];

        for (const packageJsonPath of candidates) {
            if (!existsSync(packageJsonPath)) {
                continue;
            }
            const packageJson = readFileSync(packageJsonPath, 'utf8');
            const parsed = JSON.parse(packageJson) as { version?: unknown };
            if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
                return parsed.version.trim();
            }
        }
    } catch {
        // Fall through to fallback
    }
    return '0.0.0';
}

export const GANDR_VERSION = resolveVersion();
