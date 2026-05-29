#!/usr/bin/env bash
# OpenSpec Safety Hook — destructive command detection
# Configure in .claude/settings.json as a PreToolUse hook
#
# Exit codes:
#   0 = safe (allow)
#   2 = destructive pattern detected (block)
#
# Usage:
#   This script receives the command string to evaluate via stdin or as $1.
#   It checks for destructive patterns and blocks them.

set -euo pipefail

# Read command from argument or stdin
COMMAND="${1:-$(cat)}"

# Whitelisted safe targets for rm -rf
SAFE_TARGETS="node_modules|dist|\.next|__pycache__|build|coverage|\.cache|\.turbo|\.tsbuildinfo"

# Check if rm -rf targets a safe directory
check_rm_safe() {
  local cmd="$1"
  # Extract the target path from rm -rf command
  local target
  target=$(echo "$cmd" | grep -oP '(?<=rm\s+-rf\s+)(\S+)' | head -1)
  if [ -z "$target" ]; then
    target=$(echo "$cmd" | grep -oP '(?<=rm\s+-r\s+-f\s+)(\S+)' | head -1)
  fi
  if [ -z "$target" ]; then
    return 1  # No target found, treat as unsafe
  fi

  # Get the basename of the target
  local basename
  basename=$(basename "$target")

  # Check against whitelist
  if echo "$basename" | grep -qP "^($SAFE_TARGETS)$"; then
    return 0  # Safe
  fi

  return 1  # Not in whitelist, treat as destructive
}

# --- Destructive pattern checks ---

# File system destruction: rm -rf (unless targeting safe directories)
if echo "$COMMAND" | grep -qP 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-r\s+-f|-f\s+-r))\s'; then
  if check_rm_safe "$COMMAND"; then
    exit 0
  fi
  echo "BLOCKED: Destructive file deletion detected: $COMMAND"
  exit 2
fi

# Database destruction
if echo "$COMMAND" | grep -qiP '(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+)'; then
  echo "BLOCKED: Destructive database operation detected: $COMMAND"
  exit 2
fi

# Git destructive operations
if echo "$COMMAND" | grep -qP 'git\s+push\s+.*--force'; then
  echo "BLOCKED: Force push detected: $COMMAND"
  exit 2
fi

if echo "$COMMAND" | grep -qP 'git\s+reset\s+--hard'; then
  echo "BLOCKED: Hard reset detected: $COMMAND"
  exit 2
fi

if echo "$COMMAND" | grep -qP 'git\s+(checkout|restore)\s+\.'; then
  echo "BLOCKED: Discard all changes detected: $COMMAND"
  exit 2
fi

# Infrastructure destruction
if echo "$COMMAND" | grep -qP 'kubectl\s+delete'; then
  echo "BLOCKED: Kubernetes resource deletion detected: $COMMAND"
  exit 2
fi

if echo "$COMMAND" | grep -qP 'docker\s+system\s+prune'; then
  echo "BLOCKED: Docker system prune detected: $COMMAND"
  exit 2
fi

# Command is safe
exit 0
