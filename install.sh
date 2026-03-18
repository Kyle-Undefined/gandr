#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="gandr"
WEAVER_NAME="gandr-weaver"
REPO="kyle-undefined/gandr"
RELEASE_REF="${GANDR_VERSION:-__GANDR_RELEASE_REF__}"
TEMP_FILES=()
GANDR_WAS_BUSY=0

if [ "$RELEASE_REF" = "__GANDR_RELEASE_REF__" ]; then
    echo "[gandr] install.sh is a release-installer template." >&2
    echo "[gandr] Use install.local.sh for local development, or run the release-hosted install.sh asset." >&2
    echo "[gandr] You can also set GANDR_VERSION explicitly when testing this template." >&2
    exit 1
fi

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
        # fuser unavailable; assume not busy
        return 1
    fi

    fuser "$target" >/dev/null 2>&1
}

move_into_place() {
    local source_path="$1"
    local target_path="$2"

    if ! mv -f "$source_path" "$target_path"; then
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

    move_into_place "$temp_path" "$target_path"
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

# ─── Download binary ──────────────────────────────────────────────────────────

CHECKSUMS_PATH="$(mktemp)"
TEMP_FILES+=("$CHECKSUMS_PATH")

BASE_URL="https://github.com/${REPO}/releases/download/${RELEASE_REF}"
BINARY_URL="${BASE_URL}/gandr-linux-${BUILD_ARCH}"
BINARY_CHECKSUMS_URL="${BASE_URL}/gandr-checksums.txt"

echo "[gandr] Resolved release ${RELEASE_REF}"

echo "[gandr] Downloading checksums for ${RELEASE_REF}..."
curl -fsSL --connect-timeout 10 --max-time 60 "$BINARY_CHECKSUMS_URL" -o "$CHECKSUMS_PATH"

echo "[gandr] Downloading gandr-linux-${BUILD_ARCH} for ${RELEASE_REF}..."
mkdir -p "$INSTALL_DIR"
BINARY_TMP_PATH="$(make_temp_path "$BINARY_NAME")"
TEMP_FILES+=("$BINARY_TMP_PATH")

if detect_running_binary "$INSTALL_DIR/$BINARY_NAME"; then
    GANDR_WAS_BUSY=1
fi

curl -fsSL --connect-timeout 10 --max-time 300 "$BINARY_URL" -o "$BINARY_TMP_PATH"

EXPECTED_SHA="$(awk '/ gandr-linux-'"${BUILD_ARCH}"'$/ { print $1 }' "$CHECKSUMS_PATH")"
if [ -z "$EXPECTED_SHA" ]; then
    echo "[gandr] Failed to find checksum for gandr-linux-${BUILD_ARCH}"
    exit 1
fi

ACTUAL_SHA="$(sha256sum "$BINARY_TMP_PATH" | awk '{ print $1 }')"
if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
    echo "[gandr] Checksum verification failed for $BINARY_TMP_PATH"
    exit 1
fi

chmod +x "$BINARY_TMP_PATH"
move_into_place "$BINARY_TMP_PATH" "$INSTALL_DIR/$BINARY_NAME"
echo "[gandr] Verified checksum for $INSTALL_DIR/$BINARY_NAME"
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
    echo "[gandr] Run 'wsl -l -v' in Windows to find your distro name if this is incorrect."
fi
WSL_DISTRO="${WSL_DISTRO_NAME:-Ubuntu}"
WEAVER_WSL_PATH="$INSTALL_DIR/$WEAVER_NAME"

echo ""
print_claude_desktop_config_instructions "$WSL_DISTRO" "$WEAVER_WSL_PATH"

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "✓ Gandr $("$INSTALL_DIR/$BINARY_NAME" --version) installed successfully."
if [ "$GANDR_WAS_BUSY" -eq 1 ]; then
    echo "  Claude Desktop is still using the previous gandr process."
    echo "  Fully quit and reopen Claude Desktop to activate the new version."
else
    echo "  Restart Claude Desktop after updating the config."
fi
