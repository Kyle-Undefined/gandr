#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="gandr"
WEAVER_NAME="gandr-weaver"
TEMP_FILES=()
GANDR_WAS_BUSY=0

cleanup() {
    if [ "${#TEMP_FILES[@]}" -eq 0 ]; then
        return
    fi

    rm -f "${TEMP_FILES[@]}"
}

trap cleanup EXIT

make_temp_path() {
    local stem="$1"
    mktemp "$INSTALL_DIR/.${stem}.XXXXXX"
}

detect_running_binary() {
    local target="$1"

    if [ ! -e "$target" ]; then
        return 1
    fi

    if ! command -v fuser >/dev/null 2>&1; then
        return 1
    fi

    fuser "$target" >/dev/null 2>&1
}

replace_file_atomically() {
    local source_path="$1"
    local target_path="$2"
    local label="$3"
    local temp_path

    temp_path="$(make_temp_path "$label")"
    TEMP_FILES+=("$temp_path")

    cp "$source_path" "$temp_path"
    chmod +x "$temp_path"

    if ! mv -f "$temp_path" "$target_path"; then
        echo "[gandr] Failed to replace $target_path"
        echo "[gandr] Close Claude Desktop and retry the install."
        exit 1
    fi
}

write_file_atomically() {
    local target_path="$1"
    local label="$2"
    local temp_path

    temp_path="$(make_temp_path "$label")"
    TEMP_FILES+=("$temp_path")

    cat > "$temp_path"
    chmod +x "$temp_path"

    if ! mv -f "$temp_path" "$target_path"; then
        echo "[gandr] Failed to replace $target_path"
        echo "[gandr] Close Claude Desktop and retry the install."
        exit 1
    fi
}

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

if detect_running_binary "$INSTALL_DIR/$BINARY_NAME"; then
    GANDR_WAS_BUSY=1
fi

replace_file_atomically "$BINARY_PATH" "$INSTALL_DIR/$BINARY_NAME" "$BINARY_NAME"
echo "[gandr] Installed binary to $INSTALL_DIR/$BINARY_NAME"

# ─── Install weaver ───────────────────────────────────────────────────────────

WEAVER_PATH="$INSTALL_DIR/$WEAVER_NAME"
write_file_atomically "$WEAVER_PATH" "$WEAVER_NAME" << WEAVER
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
echo "[gandr] Installed weaver to $WEAVER_PATH"

# ─── Print Claude Desktop config instructions ────────────────────────────────

if [ -z "${WSL_DISTRO_NAME:-}" ]; then
    echo "[gandr] Warning: WSL_DISTRO_NAME not set, defaulting to 'Ubuntu'"
    echo "[gandr] If this is incorrect, set WSL_DISTRO_NAME before running this script."
fi
WSL_DISTRO="${WSL_DISTRO_NAME:-Ubuntu}"

echo ""
print_claude_desktop_config_instructions "$WSL_DISTRO" "$WEAVER_PATH"

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "✓ Gandr $("$INSTALL_DIR/$BINARY_NAME" --version) installed successfully."
if [ "$GANDR_WAS_BUSY" -eq 1 ]; then
    echo "  Claude Desktop is still using the previous gandr process."
    echo "  Fully quit and reopen Claude Desktop to activate the new version."
else
    echo "  Restart Claude Desktop after updating the config."
fi
