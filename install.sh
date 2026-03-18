#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="gandr"
WEAVER_NAME="gandr-weaver"
REPO="kyle-undefined/gandr"
RELEASE_REF="${GANDR_VERSION:-__GANDR_RELEASE_REF__}"

if [ "$RELEASE_REF" = "__GANDR_RELEASE_REF__" ]; then
    echo "[gandr] install.sh is a release-installer template." >&2
    echo "[gandr] Use install.local.sh for local development, or run the release-hosted install.sh asset." >&2
    echo "[gandr] You can also set GANDR_VERSION explicitly when testing this template." >&2
    exit 1
fi

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

BINARY_PATH="$INSTALL_DIR/$BINARY_NAME"
CHECKSUMS_PATH="$(mktemp)"

cleanup() {
    rm -f "$CHECKSUMS_PATH"
}

trap cleanup EXIT

BASE_URL="https://github.com/${REPO}/releases/download/${RELEASE_REF}"
BINARY_URL="${BASE_URL}/gandr-linux-${BUILD_ARCH}"
BINARY_CHECKSUMS_URL="${BASE_URL}/gandr-checksums.txt"

echo "[gandr] Resolved release ${RELEASE_REF}"

echo "[gandr] Downloading checksums for ${RELEASE_REF}..."
curl -fsSL --connect-timeout 10 --max-time 60 "$BINARY_CHECKSUMS_URL" -o "$CHECKSUMS_PATH"

echo "[gandr] Downloading gandr-linux-${BUILD_ARCH} for ${RELEASE_REF}..."
mkdir -p "$INSTALL_DIR"
curl -fsSL --connect-timeout 10 --max-time 300 "$BINARY_URL" -o "$BINARY_PATH"

EXPECTED_SHA="$(awk '/ gandr-linux-'"${BUILD_ARCH}"'$/ { print $1 }' "$CHECKSUMS_PATH")"
if [ -z "$EXPECTED_SHA" ]; then
    echo "[gandr] Failed to find checksum for gandr-linux-${BUILD_ARCH}"
    exit 1
fi

ACTUAL_SHA="$(sha256sum "$BINARY_PATH" | awk '{ print $1 }')"
if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
    echo "[gandr] Checksum verification failed for $BINARY_PATH"
    exit 1
fi

chmod +x "$BINARY_PATH"
echo "[gandr] Verified checksum for $BINARY_PATH"
echo "[gandr] Installed binary to $BINARY_PATH"

# ─── Install weaver ───────────────────────────────────────────────────────────

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
