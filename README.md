# Gandr

> **Note:** This project exists as a workaround until Claude Code natively supports WSL/Windows integration with Claude Desktop. Tracked in [anthropics/claude-code#12506](https://github.com/anthropics/claude-code/issues/12506).

Gandr is a WSL bridge for Claude Desktop on Windows.

It works as an MCP server, **not** a native Claude Desktop integration. Claude Desktop communicates with Gandr through the Model Context Protocol over stdio, and Gandr exposes a set of tools; one that delegates tasks to Claude Code running inside WSL, and several that operate on the WSL filesystem directly.

When Gandr delegates a task, it spawns Claude Code in non-interactive print mode (`claude -p`), writes the prompt over `stdin`, and streams the result back to Claude Desktop.

This is not Claude Desktop running natively in WSL. It is Claude Desktop on Windows making MCP tool calls that get routed into WSL through Gandr.

The Claude Desktop Code tab attempts to run Claude Code natively on Windows and does not route through Gandr or WSL. It will not work with this setup. Use the chat tab for all tasks.

## Why Gandr

Gandr is for people who want Claude Desktop's chat UI, but want execution to happen inside a real Linux environment instead of the Windows host.

It keeps Claude Desktop as the front end while routing coding, shell, and file tasks through Claude Code running in WSL. That means Claude works with the same Linux tools, dotfiles, auth state, and hooks you already use in your normal WSL setup.

The name comes from Old Norse _gandr_, a magical conduit or channel. It shares its word roots with [Galdur](https://github.com/kyle-undefined/galdur).

## Requirements

- Windows with WSL2
- A working WSL distro on your machine
- [Claude Desktop](https://claude.ai/download) installed on Windows
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated inside WSL
- `claude` available on your WSL `PATH`
- [Bun](https://bun.sh) installed in WSL if you want to build from source

The install flow targets whichever WSL distro you run it from. Ubuntu is used as a fallback if the distro cannot be detected.

## What Gandr does

Gandr acts as a narrow MCP bridge between Claude Desktop and Claude Code.

In practice, the flow looks like this:

```text
Claude Desktop (Windows UI)
  -> starts gandr through wsl.exe
  -> gandr receives MCP requests over stdio
  -> gandr invokes Claude Code inside WSL
  -> Claude Code runs with your Linux environment and tools
  -> result is returned to Claude Desktop
```

Gandr does not run as a background service. Claude Desktop starts it when needed, and when Claude Desktop exits, Gandr exits too.

## Install from source

Use this if you are developing locally or want to build the binary yourself.

1. Clone the repository:

```bash
git clone https://github.com/kyle-undefined/gandr.git
cd gandr
```

2. Run the local installer:

```bash
bash ./install.local.sh
```

The installer will:

1. Detect your WSL architecture
2. Build the matching Linux binary
3. Install the `gandr` binary to `~/.local/bin/gandr` and the `gandr-weaver` wrapper to `~/.local/bin/gandr-weaver`
4. Print the `gandr` MCP server entry to add to `%APPDATA%\Claude\claude_desktop_config.json`
5. Print the installed version

Then add or update that `gandr` entry in Claude Desktop's config manually. The printed config points Claude Desktop at `gandr-weaver`, which loads your WSL shell environment and then execs `gandr`.

You can rerun the installer to update Gandr even while Claude Desktop is open. The install should still succeed, but Claude Desktop must be fully restarted before it picks up the new binary.

## Install from GitHub release

Use this if you want a prebuilt binary instead of building from source.

If you want the newest release directly from GitHub, you can use:

```bash
curl -fsSL https://github.com/kyle-undefined/gandr/releases/latest/download/install.sh | bash
```

That release-hosted installer is already pinned to the matching release version and verifies the downloaded binary against `gandr-checksums.txt` before installing.

If you want to pin a specific release explicitly, you can do:

```bash
VERSION=1.0.0
curl -fsSL "https://github.com/kyle-undefined/gandr/releases/download/${VERSION}/install.sh" | GANDR_VERSION="$VERSION" bash
```

That installs the exact version you specify and still verifies against `gandr-checksums.txt`.

The installer prints the `gandr` MCP server entry you should add to `%APPDATA%\Claude\claude_desktop_config.json`. That entry targets `~/.local/bin/gandr-weaver`, which then execs the installed `gandr` binary.

You can rerun the installer to update Gandr even while Claude Desktop is open. The install should still succeed, but Claude Desktop must be fully restarted before it picks up the new binary.

Optional Gandr runtime flags such as debug logging and a Claude child timeout are configured in Claude Desktop's MCP server args, not in Claude Desktop itself.

## Quick start

1. Install Gandr from source or from a release.
2. Confirm `claude` works inside your WSL distro.
3. Restart Claude Desktop fully on Windows.
4. Open a conversation in Claude Desktop.
5. Let Claude use the Gandr MCP tools when it needs to code, edit files, or run shell commands.

Once installed, Gandr is mostly transparent. You keep using Claude Desktop normally, and execution gets routed into WSL through Claude Code.

If you want to add optional Gandr flags, the config shape looks like:

```json
{
	"mcpServers": {
		"gandr": {
			"command": "wsl.exe",
			"args": [
				"-d",
				"Ubuntu",
				"--",
				"/home/you/.local/bin/gandr-weaver",
				"--log-level",
				"debug",
				"--claude-timeout-ms",
				"3600000"
			]
		}
	}
}
```

Use `gandr-weaver` in Claude Desktop config, not `gandr` directly. The installer creates both: `gandr` is the actual binary, and `gandr-weaver` is the wrapper Claude Desktop launches through `wsl.exe`.

`--claude-timeout-ms` is a Gandr server option passed through Claude Desktop config. It is not a native Claude Desktop timeout setting.

## Exposed tools

### Bridge

| Tool    | Description                                        |
| ------- | -------------------------------------------------- |
| `gandr` | Weave a task through to Claude Code running in WSL |

### Direct (no Claude Code needed)

| Tool              | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `read_file`       | Read a file from the WSL filesystem                    |
| `read_file_range` | Read a specific line range from a file                 |
| `write_file`      | Write or overwrite a file in the WSL filesystem        |
| `append_file`     | Append content to a file (creates if missing)          |
| `patch_file`      | Replace a unique string in a file (exactly-once match) |
| `list_dir`        | List directory contents                                |
| `delete_file`     | Delete a file                                          |
| `delete_dir`      | Delete a directory recursively                         |
| `move_file`       | Move or rename a file or directory                     |
| `file_exists`     | Check whether a file or directory exists               |
| `stat_path`       | Inspect file, directory, or symlink metadata           |
| `create_dir`      | Create a directory (recursive)                         |
| `copy_file`       | Copy a file                                            |
| `read_dir_tree`   | Recursively list a directory tree with file sizes      |
| `search_files`    | Search for files matching a glob pattern recursively   |
| `grep_content`    | Search file contents under a file or directory         |

Claude Desktop handles the MCP calls itself. In normal use, you do not manually invoke these tools.

## Hooks and environment

Because Claude Code runs inside your WSL environment, Gandr inherits the behavior of that environment rather than replacing it.

- Your WSL shell environment is used
- Your Linux filesystem is directly accessible to Claude Code
- Your installed CLI tools are available if they are on `PATH`
- Your Claude Code configuration and hooks still apply

If you already use Claude Code hooks such as `PreToolUse`, they continue to run when tasks are channelled through Gandr.

## Runtime, privacy, and safety notes

- Gandr gives Claude Code access to your WSL environment, not a restricted sandbox
- The bridge intentionally invokes Claude Code with `--dangerously-skip-permissions`; this is part of the design, so only run Gandr in a WSL environment you trust
- Claude Code may read or write files that your WSL user can access
- Gandr itself is a bridge layer; it does not bundle a model
- Gandr does not provide extra policy enforcement beyond whatever Claude Desktop, Claude Code, or your own environment already enforce
- Gandr is intended for local use on your own machine

## Troubleshooting

### Claude Desktop does not see Gandr

Check `%APPDATA%\Claude\claude_desktop_config.json` on Windows and confirm it contains a `gandr` entry under `mcpServers`.

Then restart Claude Desktop fully.

### Updating while Claude Desktop is open

If Claude Desktop already has Gandr running, reinstalling replaces the binary on disk but does not swap out the already-running process.

Claude Desktop must be fully restarted before it picks up the new binary.

### `claude` is not found

Make sure Claude Code is installed inside WSL and that `claude` resolves on your WSL `PATH`.

You can verify that from WSL with:

```bash
which claude
claude --version
```

### Healthcheck

You can confirm the binary is runnable inside WSL with:

```bash
gandr --healthcheck
```

Expected output:

```text
ok
```

### Doctor

You can run a local WSL diagnostic with:

```bash
gandr --doctor
```

The doctor command checks:

- `claude` resolves on your WSL `PATH`
- `claude --version` runs
- `claude auth status --json` reports a logged-in session
- your local Gandr install paths look consistent if present

`gandr --doctor` is intentionally WSL-local. It does not inspect Claude Desktop's Windows config, and it does not attempt a live model call.

### Long-running Claude tasks

Gandr does not enforce a Claude child timeout by default.

If you want one, pass `--claude-timeout-ms` in the Claude Desktop MCP server args. On timeout, Gandr first sends `SIGTERM`, waits briefly, and only then escalates to `SIGKILL` if Claude is still running.

### Debug logging

Gandr debug logging is controlled by Gandr, not Claude Code.

Use `--log-level debug` in the Claude Desktop MCP server args to enable debug logs. Gandr writes those logs to `stderr` and keeps MCP protocol traffic on `stdout`.

If `--log-level` is set, Gandr also writes the same filtered logs to the standard Linux/WSL state location:

```text
~/.local/state/gandr/gandr.log
```

If `XDG_STATE_HOME` is set, Gandr uses:

```text
$XDG_STATE_HOME/gandr/gandr.log
```

The file is append-only. If you run Gandr in a long-lived wrapper or service, configure external rotation such as `logrotate`.

## Development

Common local commands:

```bash
bun install
bun run check
bun run format
bun run lint
bun run build
bun run build:x64
bun run build:arm64
bun run healthcheck
bun run version
```

## Releasing

Release tags should match `package.json`.

GitHub Actions builds the release artifacts and publishes them from the tag.

## License

Licensed under the [MIT License](LICENSE).
