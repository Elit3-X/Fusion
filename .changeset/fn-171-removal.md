---
"@runfusion/fusion": major
---

summary: The dashboard now always reloads when it detects a new build version; the opt-out toggle is gone.
category: breaking
dev: Removes the `autoReloadOnVersionChange` global settings key, its Global General toggle and search entry, the `setAutoReloadEnabled` module guard, and the `/api/settings` bootstrap fetch in `installVersionCheck()`. Loop protection (`fusion:version-reload`, `fusion:version-reloaded-remote`, two-poll confirmation) is unchanged; a value still persisted in an older config is ignored because the key is no longer in `GLOBAL_SETTINGS_KEYS`.
