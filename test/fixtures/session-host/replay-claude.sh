#!/bin/sh
exec node "$(dirname "$0")/replay-claude.mjs" "$@"
