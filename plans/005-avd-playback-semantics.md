# Plan 005: Make AVD playback match ObjectAnimator semantics

> **Executor instructions**: Treat Android-supported properties as the complete
> product contract. Implement shared evaluation first, UI second. Stop on a STOP
> condition and update Plan 005 in `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 3268b817..HEAD -- lib/shapeshifter/playheadResolve.ts lib/shapeshifter/interpolators.ts lib/shapeshifter/types.ts components/editor/timeline components/editor/hooks/useEditorPlayback.ts`

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 002 and 003
- **Category**: bug
- **Planned at**: commit `3268b817`, 2026-08-12

## Why this matters

AVD animates vector alpha; group rotation, pivot, scale, and translation; and path
fill/stroke colors, alpha, stroke width, trim, and path data. The browser currently
drops or mis-evaluates several of these, so authors cannot trust preview to match
the Android resources they ship.

## Current state

- `lib/shapeshifter/playheadResolve.ts:35-39` replaces valid zero endpoints with base values.
- `lib/shapeshifter/playheadResolve.ts:58-79` switches colors at the midpoint and ignores easing.
- `lib/shapeshifter/playheadResolve.ts:82-119` ignores path block endpoint values.
- `lib/shapeshifter/scene/render.ts:43-93` does not evaluate vector alpha, stroke color/width, or trim.
- `components/editor/canvas/useWorldLayerTransform.ts:64-85` records translation differently from rotate/resize.
- `components/editor/timeline/TimelinePropertyBlock.tsx:18` hard-codes 50ms snapping.
- `lib/shapeshifter/androidCompiler.ts:222-241` maps blocks to ObjectAnimator XML.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Motion tests | `pnpm test -- lib/shapeshifter/__tests__/playheadResolve.test.ts lib/shapeshifter/__tests__/sceneRender.test.ts lib/shapeshifter/__tests__/androidCompiler.test.ts lib/shapeshifter/__tests__/androidParity.test.ts` | all pass |
| Full suite | `pnpm test` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Build | `pnpm build` | exit 0 |

## Scope

**In scope**:

- Canonical track/keyframe types and evaluation
- Android-supported number, color, and path properties
- Timeline creation/edit/readout for those properties
- Record-at-playhead behavior
- Interpolator representation and evaluation
- Corresponding compiler integration and tests

**Out of scope**:

- Smart Animate, springs, Figma prototypes, or spatial-path UI
- CSS/Lottie/PDF timing parity
- Animating properties Android VectorDrawable does not expose

## Steps

### Step 1: Compile indexed tracks once

Replace per-property filter/sort calls with tracks indexed by target and property,
sorted at mutation/import boundaries. Define overlap, gap, pre-roll, post-roll, and
exact-boundary behavior explicitly. Preserve zero and negative values using finite
number parsing rather than truthiness.

**Verify**: boundary tests cover zero, gaps, sequential blocks, and exact shared endpoints.

### Step 2: Implement Android color evaluation

Parse Android `#RGB`, `#ARGB`, `#RRGGBB`, and `#AARRGGBB` values and supported
editor colors into one internal RGBA form. Interpolate with alpha and block-local
easing. Serialize back to Android color form without swapping alpha channels.

**Verify**: midpoint, transparency, zero-alpha, and compiler parity tests pass.

### Step 3: Make geometry tracks real

Evaluate each path segment from its referenced geometry keyframes and morph mapping.
Do not read layer-level `from`/`to` when a path track exists. Reject incompatible
topology before playback/export unless Prepare for morph produces compatible geometry.

**Verify**: a three-keyframe path track reaches each exact authored geometry and exports matching values.

### Step 4: Cover every Android-supported property

Support and preview:

- vector: `alpha`;
- group: `rotation`, `pivotX/Y`, `scaleX/Y`, `translateX/Y`;
- path: `fillColor`, `pathData`, `strokeColor`, `strokeWidth`, `strokeAlpha`,
  `fillAlpha`, `trimPathStart`, `trimPathEnd`, `trimPathOffset`;
- clip path: `pathData` only where supported by the chosen Android compatibility target.

Unsupported target/property pairs must be impossible to create or visibly invalid.

**Verify**: one parity test per property compares evaluator values with generated animator values.

### Step 5: Unify record-at-playhead behavior

Moving, rotating, scaling, pivot editing, path editing, and appearance editing must
all use one transaction API. At time zero/base mode, edit the base value. At a
nonzero playhead in animation mode, insert or update a keyframe. One gesture creates
one undo entry.

**Verify**: direct manipulation tests cover every transform property at time zero and mid-clip.

### Step 6: Align timeline with Android time

Keep authored time in milliseconds because Android animator XML uses milliseconds.
Replace the unexplained fixed 50ms grid with configurable millisecond/frame display
without changing underlying precision. Show actual evaluated values and block-local
easing progress.

**Verify**: arbitrary millisecond keys round-trip exactly and UI readouts equal evaluator values.

## Test plan

- Boundary matrix for every property: pre/start/interior/end/post.
- Zero opacity, zero scale, negative translation, and wraparound trim values.
- Multi-block same-property tracks and exact gaps.
- Android color formats with alpha.
- Three-keyframe morph and incompatible morph rejection.
- Record-at-playhead plus undo/redo.

## Done criteria

- [ ] Every supported AVD property previews and exports with shared semantics.
- [ ] Zero endpoints never snap to base values.
- [ ] Colors interpolate continuously with easing.
- [ ] Geometry tracks use their own keyframe values.
- [ ] Every editing route follows one base-vs-keyframe policy.
- [ ] All verification commands pass.

## STOP conditions

- Stop if an Android API-level difference changes which properties are legal; document target profiles before coding around it.
- Stop if custom easing cannot be represented faithfully by the selected Android export form.
- Stop if existing project timing cannot be migrated without ambiguity.

## Maintenance notes

The evaluator and compiler must share property metadata: valid target kinds, value
type, default value, range, Android name, minimum SDK, and interpolation rules.
Avoid parallel switch statements that can drift.

