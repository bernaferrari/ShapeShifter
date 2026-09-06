# ShapeShifter project file

Exported `*.shapeshifter` JSON (and IndexedDB autosave) uses:

- `version` / legacy layer frames for recovery
- `documentV2` — canonical forward format (`DocumentV2`)
- `pageRoot` when the live page owns vectors

Unknown future fields are ignored on import. Prefer `documentV2` when present; fall back to `frames` / `pageRoot` if v2 validation fails.

See `lib/shapeshifter/types.ts` (`DocumentV2`) and `lib/shapeshifter/export/projectJson.ts`.
