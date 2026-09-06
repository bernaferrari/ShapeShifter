# Plan 006: Harden Android import, validation, and export

> **Executor instructions**: This is the Android release gate. Prefer blocking
> diagnostics over silent approximation. Stop on a STOP condition and update Plan
> 006 in `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 3268b817..HEAD -- lib/shapeshifter/import/androidVectorDrawable.ts lib/shapeshifter/androidCompiler.ts lib/shapeshifter/export/android.ts components/editor/ExportDialog.tsx components/editor/project/useProjectImport.ts`

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 001–005
- **Category**: correctness
- **Planned at**: commit `3268b817`, 2026-08-12

## Why this matters

The product succeeds only if Android XML can enter and leave without surprises.
Current import ignores root metadata in the editor flow, emits raw Android colors
into CSS-facing fields, lacks XML parser-error validation, and does not import AVD
target/animator bundles. Export diagnostics are generated only during download and
files can still be reported as successful despite errors.

## Current state

- `lib/shapeshifter/import/androidVectorDrawable.ts:108-138` imports only vector child layers.
- `lib/shapeshifter/import/androidVectorDrawable.ts:140-154` extracts viewport metadata separately, but `useProjectImport.ts:164-173` does not use it.
- `lib/shapeshifter/import/androidVectorDrawable.ts:71-82` copies Android color strings directly into layer styles.
- `lib/shapeshifter/androidCompiler.ts:244-447` is the more complete artboard compiler.
- `lib/shapeshifter/export/android.ts:71-136` is a second, less complete Android exporter.
- `components/editor/ExportDialog.tsx:179-225` builds Android files only after export is invoked.
- `components/editor/ExportDialog.tsx:271-275` reports export success even when diagnostics contain errors.

## Commands

| Purpose       | Command                                                                                                                                                                                     | Expected |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Android tests | `pnpm test -- lib/shapeshifter/__tests__/importers.test.ts lib/shapeshifter/__tests__/androidCompiler.test.ts lib/shapeshifter/__tests__/androidParity.test.ts components/editor/__tests__` | all pass |
| Full suite    | `pnpm test`                                                                                                                                                                                 | all pass |
| Typecheck     | `pnpm typecheck`                                                                                                                                                                            | exit 0   |
| Lint          | `pnpm lint`                                                                                                                                                                                 | exit 0   |
| Build         | `pnpm build`                                                                                                                                                                                | exit 0   |

## Scope

**In scope**:

- VectorDrawable and AVD/animator import
- Android capability validation and diagnostics
- One canonical Android compiler/export path
- Export dialog Android preflight and bundle UX
- Independent Android resource compilation in tests/CI
- Android-focused README documentation

**Out of scope**:

- Repairing Lottie, PDF, CSS, or animated SVG exporters
- Figma import/export
- Runtime Android app code generation beyond drawable/animator resources
- Silent rasterization of unsupported vector content

## Steps

### Step 1: Consolidate Android import into an asset bundle parser

Return a complete Android artboard rather than `Layer[]`: intrinsic dimensions and
units, viewport, root alpha/tint/mirroring metadata, ordered hierarchy, styles,
names, and minimum-SDK requirements. Detect XML parser errors and wrong root tags.
Convert Android color forms to the editor’s internal RGBA representation.

**Verify**: importing the Plan 001 fixtures creates semantically equal canonical artboards.

### Step 2: Import AnimatedVectorDrawable bundles

Support a ZIP or multi-file selection containing drawable and animator resources.
Resolve `animated-vector` drawable references, target names, animator sets,
startOffset/duration, ordering, values, value types, and interpolators. Produce
diagnostics for unresolved resources and unsupported constructs; never silently omit them.

**Verify**: import a generated bundle, evaluate every track, and compare against the source project fixture.

### Step 3: Define Android capability profiles

Create centralized metadata for platform `VectorDrawable`, `AnimatedVectorDrawable`,
and the selected AndroidX compatibility target. For every feature record target
node kinds, animatability, minimum SDK, allowed value type/range, and serialization
rules. Use it in inspector controls, timeline track creation, validation, preview,
and compiler diagnostics.

**Verify**: table-driven tests cover every supported property and at least one rejected target/property pair.

### Step 4: Remove the duplicate Android exporter

Make `compileAndroidArtboard` the only production Android serialization path.
Delete or reduce `lib/shapeshifter/export/android.ts` to a compatibility wrapper
only if externally imported. Static vector and animated bundle exports must share
resource naming, color conversion, hierarchy, and style serialization.

**Verify**: `rg "exportAnimatedVectorDrawable|exportVectorDrawable"` finds only the canonical API and deliberate compatibility references.

### Step 5: Add continuous export preflight

Run inexpensive Android validation as document/timeline state changes. Show errors
and warnings in the inspector/export dialog with layer/property links. Disable the
download action on error-level diagnostics. Warnings require acknowledgement only
when output remains semantically valid.

**Verify**: UI tests prove an incompatible morph cannot download or show a success toast.

### Step 6: Independently compile generated resources

Add a CI/test harness that places generated resources in a minimal Android resource
fixture and runs an available Android resource compiler or Gradle resource task.
Also parse the resulting XML independently of the production parser. Keep the
harness deterministic and cache toolchain artifacts in CI.

**Verify**: canonical static and animated fixtures compile; malformed target names,
resource references, incompatible morphs, and illegal properties fail.

### Step 7: Rewrite product documentation around Android

Update README and in-product copy to describe:

- supported VectorDrawable/AVD attributes;
- API/min-SDK compatibility;
- import bundle layout;
- morph compatibility and Prepare for morph;
- generated `res/drawable` and `res/animator` files;
- deliberately unsupported SVG/Figma features.

Do not market unsupported exporters as fidelity-equivalent.

**Verify**: documentation examples use files generated by the canonical compiler and pass the independent compilation test.

## Test plan

- Vector XML round trip for every supported static attribute.
- AVD bundle round trip for every supported animated property.
- Invalid XML, unresolved resource, duplicate target name, unsupported property,
  incompatible path, custom interpolator, and API-level diagnostics.
- Export preflight blocking and warning behavior.
- Independent Android resource compilation in CI.

## Done criteria

- [ ] VectorDrawable import preserves viewport, intrinsic size, root metadata, hierarchy, clips, and styles.
- [ ] AVD/animator bundles import into editable tracks.
- [ ] One compiler owns all Android output.
- [ ] Error-level diagnostics block download and success messaging.
- [ ] Generated fixtures pass independent Android resource compilation.
- [ ] README describes the Android-first product accurately.
- [ ] All verification commands pass.

## STOP conditions

- Stop before adding or downloading an Android SDK/Gradle toolchain if CI licensing, size, or availability is unresolved; propose alternatives.
- Stop if resolving Android resources requires a general Android resource merger; scope supported local references explicitly first.
- Stop if a feature would require silent rasterization or semantic approximation.

## Maintenance notes

Pin the independent Android validation environment and update it deliberately.
Whenever Android adds a supported property or compatibility behavior, update the
capability table, fixtures, importer, evaluator, and compiler in one change.
