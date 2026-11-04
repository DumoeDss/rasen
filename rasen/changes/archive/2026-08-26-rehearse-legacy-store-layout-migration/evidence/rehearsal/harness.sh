#!/usr/bin/env bash
# Isolated rehearsal harness for change `rehearse-legacy-store-layout-migration`.
#
# SAFETY. The real store at
#   E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/rasen-store
# is the user's LIVE planning store and is READ-ONLY material here. The
# disposable copies carry the SAME uid (f35acc7d-...), so a command that
# reached the real machine registry would resolve that uid to the REAL path.
# Every rasen invocation below therefore runs with RASEN_HOME and
# GIT_CONFIG_GLOBAL redirected into a disposable temp root, and every stage
# runs h_preflight first (tasks.md 1.4).
#
# CLI PINNING. The repo working tree is shared with a sibling change that has
# uncommitted edits to store/identity.ts and store-planning/internal/*, and
# `pnpm build` rm -rf's dist before compiling, so a shared `dist/` would both
# vanish mid-stage and carry the sibling's work-in-progress into the behavior
# being characterized. The harness therefore runs a CLI built from a pinned
# `git archive HEAD` tree in the temp root (h_build_pinned), so the evidence
# describes committed dev/0.2.0. Post-fix verification rebuilds that same
# pinned tree with only this change's patch applied.
#
# Usage:  source harness.sh      # exports env, defines rasen()/h_preflight()/h_step()
#         h_build_pinned         # (re)create + build the pinned CLI
#         h_bootstrap            # (re)create temp root + copies
set -u

REPO="E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code"
REAL="E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/rasen-store"
BASE="C:/Users/Sayo/AppData/Local/Temp/rasen-g2"
EVIDENCE="$REPO/rasen/changes/rehearse-legacy-store-layout-migration/evidence/rehearsal"

export RASEN_HOME="$BASE/rasen-home"
export GIT_CONFIG_GLOBAL="$BASE/gitconfig"
# Compatibility aliases that sit BELOW RASEN_HOME in precedence; set anyway so
# no older code path can fall back to the real machine home.
export XDG_DATA_HOME="$BASE/xdg-data"
export XDG_CONFIG_HOME="$BASE/xdg-config"
# Rehearsal commands must not report themselves as real usage.
export RASEN_TELEMETRY=0

# Two pinned CLI trees. `pinned` is the committed tree alone, which is what
# stages 00-03 were captured against. `pinned-fixed` is the same archive with
# only THIS change's src files copied over, which is what 04-postfix/ and the
# pre-fix-red guard comparison were captured against. Point RASEN_CLI_TREE at
# whichever one a re-run needs.
PINNED="$BASE/${RASEN_CLI_TREE:-pinned}"
PRISTINE="$BASE/copy-pristine"
CLONE="$BASE/copy-clone"
ENRICHED="$BASE/copy-enriched"

# The pinned built CLI.
rasen() { node "$PINNED/bin/rasen.js" "$@"; }

# --- Per-stage machine home -------------------------------------------------
# Each stage gets its OWN redirected RASEN_HOME. The disposable copies share the
# real store's uid, so registering two of them in one registry would collide
# (store_id_conflict) and tempt an `unregister` — a command that must never be
# aimed at a real registry. Separate homes make that situation impossible and
# keep each stage's coordination state independent.
h_use_home() {
  export RASEN_HOME="$BASE/rasen-home-$1"
  export XDG_DATA_HOME="$BASE/xdg-data-$1"
  export XDG_CONFIG_HOME="$BASE/xdg-config-$1"
  mkdir -p "$RASEN_HOME" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME"
  echo "machine home -> <temp>/rasen-home-$1"
}

# --- MANDATORY per-stage pre-flight (tasks.md 1.4) ---------------------------
# Exit 2 == abort the stage. NEVER "repair" a failure by unregistering anything.
h_preflight() {
  local out
  out="$(rasen store list --json 2>&1)" || { echo "PREFLIGHT-FAIL: store list failed"; echo "$out"; return 2; }
  printf '%s' "$out" | node "$EVIDENCE/preflight.js" "$BASE"
}

# h_step <stage-dir> <NN-slug> <cwd> <command...>
# Captures stdout+stderr and the exit code into <stage-dir>/<NN-slug>.txt.
h_step() {
  local dir="$1"; shift
  local slug="$1"; shift
  local cwd="$1"; shift
  mkdir -p "$dir"
  printf '$ (cd %s) %s
' "$(h_scrub "$cwd")" "$(h_scrub "$*")" > "$dir/$slug.txt"
  local code=0
  ( cd "$cwd" && "$@" ) > "$dir/$slug.raw" 2>&1 || code=$?
  h_scrub_file "$dir/$slug.raw" >> "$dir/$slug.txt"
  rm -f "$dir/$slug.raw"
  printf '
[exit code: %s]
' "$code" >> "$dir/$slug.txt"
  echo "$slug exit=$code"
  return 0
}

# Replaces machine-specific absolute paths with stable placeholders so the
# committed evidence is readable and diffable (handles both `/` and escaped
# `\\` separators, so JSON payloads scrub too).
h_scrub() {
  printf '%s' "$1" | sed -e "s|C:[\\/][\\/]*Users[\\/][\\/]*Sayo[\\/][\\/]*AppData[\\/][\\/]*Local[\\/][\\/]*Temp[\\/][\\/]*rasen-g2|<temp>|g" -e "s|E:[\\/][\\/]*AI[\\/][\\/]*ChatAI[\\/][\\/]*Agents[\\/][\\/]*VibeCodingProjects[\\/][\\/]*workflow[\\/][\\/]*Reference[\\/][\\/]*rasen-store|<real-store>|g" -e "s|E:[\\/][\\/]*AI[\\/][\\/]*ChatAI[\\/][\\/]*Agents[\\/][\\/]*VibeCodingProjects[\\/][\\/]*workflow[\\/][\\/]*Reference[\\/][\\/]*OpenSpec-code|<repo>|g"
}
h_scrub_file() {
  sed -e "s|C:[\\/][\\/]*Users[\\/][\\/]*Sayo[\\/][\\/]*AppData[\\/][\\/]*Local[\\/][\\/]*Temp[\\/][\\/]*rasen-g2|<temp>|g" -e "s|E:[\\/][\\/]*AI[\\/][\\/]*ChatAI[\\/][\\/]*Agents[\\/][\\/]*VibeCodingProjects[\\/][\\/]*workflow[\\/][\\/]*Reference[\\/][\\/]*rasen-store|<real-store>|g" -e "s|E:[\\/][\\/]*AI[\\/][\\/]*ChatAI[\\/][\\/]*Agents[\\/][\\/]*VibeCodingProjects[\\/][\\/]*workflow[\\/][\\/]*Reference[\\/][\\/]*OpenSpec-code|<repo>|g" "$1"
}

# --- (Re)build the pinned CLI from the committed tree ------------------------
# Rebuilds the pinned tree named by RASEN_CLI_TREE. With RASEN_CLI_TREE=pinned-fixed,
# copy this change's src files over the archive before building:
#   src/core/store/layout-migration/{plan,types,index}.ts
#   src/commands/store-migrate-layout.ts
h_build_pinned() {
  rm -rf "$PINNED"
  mkdir -p "$PINNED"
  ( cd "$REPO" && git archive HEAD ) | tar -x -C "$PINNED"
  cmd //c "mklink /J \"$(cygpath -w "$PINNED/node_modules")\" \"$(cygpath -w "$REPO/node_modules")\"" > /dev/null
  ( cd "$PINNED" && node build.js )
}

# --- (Re)create the temp root and the disposable copies ----------------------
h_bootstrap() {
  mkdir -p "$BASE/rasen-home" "$BASE/xdg-data" "$BASE/xdg-config"
  printf '[user]
	name = Rasen Rehearsal
	email = rehearsal@example.invalid
[init]
	defaultBranch = master
[core]
	longpaths = true
' > "$BASE/gitconfig"
  rm -rf "$PRISTINE" "$CLONE"
  # robocopy: exit 0-7 = success, >= 8 = failure. It only READS the source.
  cmd //c "robocopy \"$(cygpath -w "$REAL")\" \"$(cygpath -w "$PRISTINE")\" /E /NFL /NDL /NJH /R:1 /W:1" > "$BASE/robocopy.log" 2>&1
  local rc=$?
  if [ "$rc" -ge 8 ]; then echo "ROBOCOPY FAILED ($rc)"; return 1; fi
  git clone "$REAL" "$CLONE" 2>&1 | tail -2
  # The clone's origin points AT the real store: keep fetch (real survey
  # material) but make push impossible.
  git -C "$CLONE" remote set-url --push origin DISABLED-no-push-to-real-store
  echo "bootstrap ok (robocopy exit $rc)"
}
