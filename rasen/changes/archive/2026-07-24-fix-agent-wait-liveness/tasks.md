# Tasks

## 1. Core fixes
- [x] 1.1 Stale-signal discard (`discardStaleSignal`, `STALE_SIGNAL_MS=120s`) wired into `wait` first beat
- [x] 1.2 `DEFAULT_BEAT_SECONDS` 270 → 100; CLI help + locale strings updated
- [x] 1.3 `DEFAULT_CONTEXT_FLOOR` → 0; gate only fires when configured floor > 0; config key/schema accept 0

## 2. Docs & templates
- [x] 2.1 Step B.4 playbook template updated (timeout warning, stale grace, no floor)

## 3. Verification
- [x] 3.1 Unit/command tests updated + new stale-signal cases
- [x] 3.2 Full test suite green
- [x] 3.3 Live sonnet-subagent park test: real beats + resume delivery
