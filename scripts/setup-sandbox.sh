#!/usr/bin/env bash
# Krbn — sandbox bootstrap for AI/CI ephemeral Linux shells.
#
# Why this exists: the isolated sandbox ships Node+npm but NOT `bun`, and the
# project runs everything through bun (`bun test`, `@types/bun`). Two things bite:
#   1. npm's default global prefix is /usr, which the sandbox user can't write to
#      (global installs fail with EACCES). We repoint it at $HOME.
#   2. bun isn't installed. We install it globally via npm.
#
# Idempotent and fast: if bun is already available it does nothing but print the
# PATH line. Safe to run at the start of every session.
#
# Usage:
#   source scripts/setup-sandbox.sh   # sets PATH in the current shell
#   # or: bash scripts/setup-sandbox.sh && export PATH="$HOME/.npm-global/bin:$PATH"
#
# NOTE: each sandbox shell call is independent and does NOT source ~/.bashrc, so
# every command that uses bun must have this on PATH:
#   export PATH="$HOME/.npm-global/bin:$PATH"

set -euo pipefail

NPM_PREFIX="$HOME/.npm-global"
export PATH="$NPM_PREFIX/bin:$PATH"

if command -v bun >/dev/null 2>&1; then
  echo "bun already available: $(bun -v)"
else
  echo "Installing bun (one-time per sandbox)..."
  # Repoint npm global prefix to a writable dir (persists in ~/.npmrc).
  npm config set prefix "$NPM_PREFIX"
  mkdir -p "$NPM_PREFIX"
  npm install -g bun
  echo "Installed bun: $(bun -v)"
fi

echo 'PATH ready. For later shells: export PATH="$HOME/.npm-global/bin:$PATH"'
