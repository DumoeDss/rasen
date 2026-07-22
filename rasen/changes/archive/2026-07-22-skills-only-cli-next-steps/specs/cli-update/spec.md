## REMOVED Requirements

### Requirement: Update respects delivery setting
**Reason**: Residual Phase-A leftover. The `delivery` setting was retired when the command delivery surface was removed; there is no longer a delivery dimension for update to add or remove files by. Skills are the only delivery format, always generated for selected workflows, and any pre-existing command files are removed unconditionally.
**Migration**: The behavior this requirement described is now covered by the current `cli-update` requirements (skills always regenerated) and the `legacy-cleanup` capability's "Retired command files are pruned on init and update" requirement (unconditional removal of any leftover rasen command files, including on installs that previously had a command-only or `both` layout). No delivery value is read to decide file add/remove.
