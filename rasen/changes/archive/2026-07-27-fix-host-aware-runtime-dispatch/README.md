# fix-host-aware-runtime-dispatch

Make Rasen detect the current Claude/Codex host, inherit it as the default worker runtime, select native same-host dispatch, validate cross-runtime bridges, and avoid redundant Codex-native wait/completion traffic.
