import { mkdir, rm, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

type Arch = 'x64' | 'arm64';
type ArchArg = Arch | 'current';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, '..');
const outDir = join(rootDir, 'dist');
const entry = join(rootDir, 'src', 'index.ts');

void main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});

async function main(): Promise<void> {
    const archArg = parseArchArg(process.argv.slice(2));
    const targets = resolveTargets(archArg);
    const version = await readVersion();

    await mkdir(outDir, { recursive: true });

    for (const arch of targets) {
        const outfile = join(outDir, `gandr-linux-${arch}`);
        await rm(outfile, { force: true });

        const target = `bun-linux-${arch}` as Bun.Build.CompileTarget;
        console.log(`[gandr] Building ${target}...`);

        const result = await Bun.build({
            entrypoints: [entry],
            compile: {
                target,
                outfile,
            },
            define: {
                __GANDR_VERSION__: JSON.stringify(version),
            },
            minify: true,
        });

        if (!result.success) {
            for (const log of result.logs) {
                console.error(log);
            }
            throw new Error(`Build failed for ${target}`);
        }

        console.log(`[gandr] Built dist/gandr-linux-${arch}`);
    }
}

function resolveTargets(arch: ArchArg): Arch[] {
    if (arch === 'current') {
        return [process.arch === 'arm64' ? 'arm64' : 'x64'];
    }
    if (arch !== 'x64' && arch !== 'arm64') {
        throw new Error(`Unsupported --arch value: ${arch}. Use x64 or arm64.`);
    }
    return [arch];
}

function parseArchArg(argv: string[]): ArchArg {
    for (let i = 0; i < argv.length; i += 1) {
        const value = argv[i];
        if (value === '--arch') {
            return (argv[i + 1] ?? 'current') as ArchArg;
        }
        if (value.startsWith('--arch=')) {
            return value.slice('--arch='.length) as ArchArg;
        }
    }
    return 'current';
}

async function readVersion(): Promise<string> {
    const packageJson = await readFile(join(rootDir, 'package.json'), 'utf8');
    const parsed = JSON.parse(packageJson) as { version?: unknown };
    if (typeof parsed.version !== 'string' || parsed.version.trim().length === 0) {
        throw new Error('package.json is missing a valid version');
    }
    return parsed.version.trim();
}
