/**
 * Static template strings for Bash completion scripts.
 * These are Bash-specific helper functions that never change.
 */

export const BASH_DYNAMIC_HELPERS = `# Dynamic completion helpers

_rasen_complete_changes() {
  local changes
  changes=$(rasen __complete changes 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$changes" -- "$cur"))
}

_rasen_complete_specs() {
  local specs
  specs=$(rasen __complete specs 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$specs" -- "$cur"))
}

_rasen_complete_items() {
  local items
  items=$(rasen __complete changes 2>/dev/null | cut -f1; rasen __complete specs 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$items" -- "$cur"))
}

_rasen_complete_schemas() {
  local schemas
  schemas=$(rasen __complete schemas 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$schemas" -- "$cur"))
}

_rasen_complete_profiles() {
  local profiles
  profiles=$(rasen __complete profiles 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$profiles" -- "$cur"))
}

_rasen_complete_saved_profiles() {
  local profiles
  profiles=$(rasen __complete saved-profiles 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$profiles" -- "$cur"))
}

_rasen_complete_workflows() {
  local workflows
  workflows=$(rasen __complete workflows 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$workflows" -- "$cur"))
}`;
