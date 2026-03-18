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
3. Install it to `~/.local/bin/gandr`
4. Print the `gandr` MCP server entry to add to `%APPDATA%\Claude\claude_desktop_config.json`
5. Print the installed version

Then add or update that `gandr` entry in Claude Desktop's config manually.

Restart Claude Desktop fully after installation.

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

The installer prints the `gandr` MCP server entry you should add to `%APPDATA%\Claude\claude_desktop_config.json`.

Restart Claude Desktop fully after installation.

## Quick start

1. Install Gandr from source or from a release.
2. Confirm `claude` works inside your WSL distro.
3. Restart Claude Desktop fully on Windows.
4. Open a conversation in Claude Desktop.
5. Let Claude use the Gandr MCP tools when it needs to code, edit files, or run shell commands.

Once installed, Gandr is mostly transparent. You keep using Claude Desktop normally, and execution gets routed into WSL through Claude Code.

## Exposed tools

### Bridge

| Tool    | Description                                        |
| ------- | -------------------------------------------------- |
| `gandr` | Weave a task through to Claude Code running in WSL |

### Direct (no Claude Code needed)

| Tool          | Description                                            |
| ------------- | ------------------------------------------------------ |
| `read_file`   | Read a file from the WSL filesystem                    |
| `write_file`  | Write or overwrite a file in the WSL filesystem        |
| `append_file` | Append content to a file (creates if missing)          |
| `patch_file`  | Replace a unique string in a file (exactly-once match) |
| `list_dir`    | List directory contents                                |
| `delete_file` | Delete a file                                          |
| `delete_dir`  | Delete a directory recursively                         |
| `move_file`   | Move or rename a file or directory                     |
| `file_exists` | Check whether a file or directory exists               |
| `create_dir`  | Create a directory (recursive)                         |

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
