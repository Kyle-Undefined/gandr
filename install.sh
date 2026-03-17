#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="gandr"
WEAVER_NAME="gandr-weaver"
REPO="kyle-undefined/gandr"
BASE_URL="https://github.com/${REPO}/releases/latest/download"

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

# ─── Download binary ──────────────────────────────────────────────────────────

BINARY_URL="${BASE_URL}/gandr-linux-${BUILD_ARCH}"
BINARY_PATH="$INSTALL_DIR/$BINARY_NAME"

echo "[gandr] Downloading gandr-linux-${BUILD_ARCH}..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$BINARY_URL" -o "$BINARY_PATH"
chmod +x "$BINARY_PATH"
echo "[gandr] Installed binary to $BINARY_PATH"

# ─── Install weaver ───────────────────────────────────────────────────────────

WEAVER_PATH="$INSTALL_DIR/$WEAVER_NAME"
cat > "$WEAVER_PATH" << WEAVER
#!/usr/bin/env bash
source ~/.bashrc 2>/dev/null || true
source ~/.profile 2>/dev/null || true
exec $HOME/.local/bin/gandr "\$@"
WEAVER
chmod +x "$WEAVER_PATH"
echo "[gandr] Installed weaver to $WEAVER_PATH"

# ─── Print Claude Desktop config instructions ────────────────────────────────

if [ -z "${WSL_DISTRO_NAME:-}" ]; then
    echo "[gandr] Warning: WSL_DISTRO_NAME not set, defaulting to 'Ubuntu'"
    echo "[gandr] Run 'wsl -l -v' in Windows to find your distro name if this is incorrect."
fi
WSL_DISTRO="${WSL_DISTRO_NAME:-Ubuntu}"
WEAVER_WSL_PATH="$INSTALL_DIR/$WEAVER_NAME"

echo ""
print_claude_desktop_config_instructions "$WSL_DISTRO" "$WEAVER_WSL_PATH"

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "✓ Gandr $("$BINARY_PATH" --version) installed successfully."
echo "  Restart Claude Desktop after updating the config."
