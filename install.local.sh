#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="gandr"

print_claude_desktop_config_instructions() {
    local wsl_distro="$1"
    local weaver_path="$2"
    cat <<EOF
[gandr] Manually add or merge this into %APPDATA%\\Claude\\claude_desktop_config.json:
[gandr] Add the "gandr" entry inside the existing "mcpServers" object, or create the file if it doesn't exist.

{
  "mcpServers": {
    "gandr": {
      "command": "wsl.exe",
      "args": ["-d", "$wsl_distro", "--", "$weaver_path"]
    }
  }
}
EOF
}

# ─── Detect architecture ──────────────────────────────────────────────────────

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)  BUILD_ARCH="x64" ;;
    aarch64) BUILD_ARCH="arm64" ;;
    *)
        echo "[gandr] Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

# ─── Build binary ─────────────────────────────────────────────────────────────

echo "[gandr] Building for $ARCH ($BUILD_ARCH)..."
bun run scripts/build.ts --arch "$BUILD_ARCH"

BINARY_PATH="$REPO_DIR/dist/gandr-linux-$BUILD_ARCH"

if [ ! -f "$BINARY_PATH" ]; then
    echo "[gandr] Build failed - binary not found at $BINARY_PATH"
    exit 1
fi

# ─── Install binary ───────────────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR"
cp "$BINARY_PATH" "$INSTALL_DIR/$BINARY_NAME"
chmod +x "$INSTALL_DIR/$BINARY_NAME"
echo "[gandr] Installed binary to $INSTALL_DIR/$BINARY_NAME"

# ─── Install weaver ───────────────────────────────────────────────────────────

WEAVER_NAME="gandr-weaver"
WEAVER_PATH="$INSTALL_DIR/$WEAVER_NAME"
cat > "$WEAVER_PATH" << WEAVER
#!/usr/bin/env bash
set -euo pipefail

if [ -f "\$HOME/.profile" ]; then
    . "\$HOME/.profile" </dev/null >/dev/null 2>&1 || true
fi

if [ -f "\$HOME/.bashrc" ]; then
    . "\$HOME/.bashrc" </dev/null >/dev/null 2>&1 || true
fi

exec "\$HOME/.local/bin/gandr" "\$@"
WEAVER
chmod +x "$WEAVER_PATH"
echo "[gandr] Installed weaver to $WEAVER_PATH"

# ─── Print Claude Desktop config instructions ────────────────────────────────

if [ -z "${WSL_DISTRO_NAME:-}" ]; then
    echo "[gandr] Warning: WSL_DISTRO_NAME not set, defaulting to 'Ubuntu-24.04'"
    echo "[gandr] If this is incorrect, set WSL_DISTRO_NAME before running this script."
fi
WSL_DISTRO="${WSL_DISTRO_NAME:-Ubuntu-24.04}"

echo ""
print_claude_desktop_config_instructions "$WSL_DISTRO" "$WEAVER_PATH"

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "✓ Gandr $("$INSTALL_DIR/$BINARY_NAME" --version) installed successfully."
echo "  Restart Claude Desktop after updating the config."
