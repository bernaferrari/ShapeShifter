# Plan 002: Make Android projects lossless and canonical

> **Executor instructions**: Follow each step and verification gate. This is a
> staged migration, not permission to rewrite the whole store. Stop when a STOP
> condition occurs. Update Plan 002 in `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 3268b817..HEAD -- lib/shapeshifter/types.ts lib/shapeshifter/documentModel.ts lib/shapeshifter/export/projectJson.ts components/editor/project/useProjectImport.ts lib/store`

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 001
- **Category**: migration
- **Planned at**: commit `3268b817`, 2026-08-12

## Why this matters

Project save/reopen currently loses `Layer.to` geometry and custom easing because
the V2 adapter stores one geometry version and accepts only named interpolators.
An Android editor must preserve exact drawable geometry, AVD targets, keyframe
values, and easing before any broader rendering work is trustworthy.

## Current state

- `lib/shapeshifter/types.ts:162-307` declares a normalized DocumentV2 parallel to V1.
- `lib/shapeshifter/documentModel.ts:148-159` stores only `pathData ?? from`.
- `lib/shapeshifter/documentModel.ts:318-337` restores `from` and `pathData`, but not `to`.
- `lib/shapeshifter/documentModel.ts:121-132` discards custom cubic Bézier strings.
- `components/editor/project/useProjectImport.ts:132-141` prioritizes DocumentV2.
- `lib/shapeshifter/export/projectJson.ts:104-137` removes `from` and `to` from frame snapshots.
- `lib/store/editorStore.ts:113-129` duplicates owner documents into active `layers`,
  `vector`, and `animation` projections.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Model tests | `pnpm test -- lib/shapeshifter/__tests__/documentModel.test.ts lib/shapeshifter/__tests__/androidParity.test.ts lib/store/__tests__/editorStore.test.ts` | all pass |
| Full suite | `pnpm test` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope**:

- `lib/shapeshifter/types.ts`
- `lib/shapeshifter/documentModel.ts`
- `lib/shapeshifter/export/projectJson.ts`
- `components/editor/project/useProjectImport.ts`
- `lib/store/workspaceState.ts`
- Store selectors/actions directly required for canonical owner access
- Corresponding model, import, and store tests

**Out of scope**:

- Canvas rendering and gesture behavior
- Android XML compilation behavior
- New non-Android node types
- General components, auto layout, constraints, or Figma frames

## Steps

### Step 1: Write the Android document contract

Document in types and tests that an artboard owns:

- intrinsic `width`/`height` with their Android dimension units preserved;
- `viewportWidth`/`viewportHeight` separately from intrinsic size;
- vector `alpha`, tint/tintMode, and autoMirrored when supported;
- ordered path, group, and clip-path nodes with unique Android target names;
- exact group transform values;
- immutable geometry versions for every path keyframe;
- tracks keyed by node and Android animatable property;
- lossless interpolator representation, including custom path/cubic easing;
- minimum-SDK/capability metadata required by gradients or fill type.

Do not add web-layout properties.

**Verify**: TypeScript compiles with fixtures expressing the complete contract.

### Step 2: Persist geometry endpoints and keyframe geometry

Replace the single-geometry adapter with distinct immutable geometry versions.
Every `pathData` keyframe must reference a geometry version; adjacent keyframes
may reference a persistent morph mapping. Never derive animation endpoints from a
mutable layer-level `from`/`to` pair once the V2 record exists.

Convert the persistence parity `it.fails` test to a normal test.

**Verify**: model and parity tests prove `from`, `to`, multi-keyframe geometry,
command IDs, and mappings survive export/import/evaluation.

### Step 3: Preserve interpolators losslessly

Change the model so named Android interpolators, custom cubic Bézier values, and
future path interpolator resource data do not pass through the narrowing
`asInterpolator` function. Unknown values must produce validation diagnostics,
not silent replacement.

**Verify**: round-trip tests compare the exact authored interpolator value.

### Step 4: Make owner data canonical

Store each page/artboard document once and derive active `layers`, vector metadata,
and animation views through selectors or adapters. Migrate one vertical slice at a
time; preserve current action signatures until callers are migrated. Remove the
requirement that every mutation call `syncActiveOwner` to avoid stale copies.

**Verify**: existing store tests plus new tests mutate a non-active artboard, switch
selection, undo, redo, export, and reopen without stale projections.

### Step 5: Migrate project import/export with backward compatibility

- Write the new lossless schema version.
- Continue reading existing V1 and V2 files.
- Prefer the legacy payload only when an older V2 payload is known to be lossy.
- Surface a migration warning rather than silently discarding unsupported data.

**Verify**: fixtures for legacy JSON, current V2 JSON, and new schema all load and
produce the expected canonical document.

## Test plan

- Extend `documentModel.test.ts` with nested groups, clip paths, two morph segments,
  zero values, custom easing, viewport/intrinsic mismatch, and undo/redo.
- Convert the Plan 001 persistence expected failure to a normal test.
- Assert semantic equality after save → import → evaluate, not raw JSON equality.

## Done criteria

- [ ] No supported path endpoint or easing is lost on round trip.
- [ ] Canonical artboards distinguish intrinsic size from viewport.
- [ ] Active-owner reads cannot become stale due to a missed sync call.
- [ ] Existing project files remain importable with explicit diagnostics.
- [ ] All verification commands pass.

## STOP conditions

- Stop if backward compatibility requires guessing between conflicting legacy payloads; report the conflict and fixture.
- Stop if a store migration requires unrelated UI redesign.
- Stop if exact Android dimension/resource expressions cannot be represented without a schema decision; propose that decision first.

## Maintenance notes

DocumentV2 should become runtime truth rather than another adapter. Do not introduce
a fourth representation. Keep stable node/geometry IDs because AVD targets,
selection, undo, and morph mappings depend on them.

