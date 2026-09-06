# Plan 004: Make vector editing matrix- and curve-correct

> **Executor instructions**: Route all edits through matrices from the evaluated
> scene. Do not add Figma-only vector-network concepts. Stop on a STOP condition
> and update Plan 004 in `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 3268b817..HEAD -- components/editor/canvas lib/shapeshifter/scene lib/shapeshifter/gestures lib/shapeshifter/path`

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 003
- **Category**: bug
- **Planned at**: commit `3268b817`, 2026-08-12

## Why this matters

An Android vector editor still needs excellent direct manipulation. Today anchor
editing ignores scale, rotation, pivot, and parent groups; rotation handles use a
different center from rendering; bounds and stroke hits use control polygons rather
than rendered curves. These errors make even valid VectorDrawable geometry unsafe to edit.

## Current state

- `components/editor/canvas/useWorldPointEditing.ts:44-80` handles only owner origin and translation.
- `components/editor/canvas/worldLayerTransforms.ts:30-42` increments local rotation without orbiting around the displayed selection center.
- `lib/shapeshifter/path/pathDataIO.ts:222-250` bounds raw command points, not curve extrema.
- `lib/shapeshifter/scene/hitTest.ts:54-98` tests control-polygon segments.
- `lib/shapeshifter/path/booleanOperations.ts:111-154` has explicitly conservative, destructive fallbacks.
- `components/editor/canvas/useWorldPointerRouter.ts:110-148` accepts non-primary edit pointers.

## Commands

| Purpose        | Command                                                                                                                                             | Expected |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Geometry tests | `pnpm test -- lib/shapeshifter/__tests__/sceneHitTest.test.ts lib/shapeshifter/__tests__/sceneSelection.test.ts components/editor/canvas/__tests__` | all pass |
| Full suite     | `pnpm test`                                                                                                                                         | all pass |
| Typecheck      | `pnpm typecheck`                                                                                                                                    | exit 0   |
| Lint           | `pnpm lint`                                                                                                                                         | exit 0   |

## Scope

**In scope**:

- World direct-edit, lasso, pen, knife, paint, resize, rotate, and selection gesture modules
- `lib/shapeshifter/scene/layerTransform.ts`
- Bounds and curve-distance geometry helpers
- Relevant unit and browser interaction tests
- Boolean UI gating/diagnostics

**Out of scope**:

- Figma vector networks
- Auto layout and frame constraints
- A new Boolean clipping kernel unless separately approved
- Freeform skew/perspective transforms unsupported by VectorDrawable

## Steps

### Step 1: Use forward/inverse evaluated matrices for every gesture

Convert world pointer coordinates through the inverse composed matrix for anchor,
handle, lasso, knife, pen, and paint operations. Draw overlays through the forward
matrix. Treat a singular matrix as a blocked edit with feedback, not a guessed point.

**Verify**: integration tests edit a path inside two transformed groups and assert exact local coordinates.

### Step 2: Correct selection rotation and resize

Freeze each selected node’s world matrix at gesture start. Apply rotation around
the displayed selection center, then derive valid Android local group/path transform
updates without changing geometry unexpectedly. Resize must use an explicit policy:
edit path coordinates or group scale, selected by the tool/action—not both implicitly.

**Verify**: tests cover translated single selection, multi-selection orbit, nonzero pivot, and nested parents.

### Step 3: Implement analytic/adaptive curve geometry

Compute cubic/quadratic extrema and arc bounds. Use cached adaptive flattening or a
nearest-point solver for stroke distance. Expand bounds by evaluated stroke where
selection semantics require it. Maintain tolerance in screen pixels across zoom.

**Verify**: bowed cubic, quadratic, arc, open stroke, and scaled-stroke fixtures hit only visible geometry.

### Step 4: Reject accidental edit pointers

Only the primary pointer and primary button may begin editing. Preserve explicit
middle-button/space panning and add cancellation for secondary touch.

**Verify**: right-click and second-touch tests produce no document/history mutation.

### Step 5: Disable incorrect Boolean commands until robust

Do not ship the current fallback as successful geometry. Either integrate a proven
path clipping kernel with transform flattening and Android-compatible output under a
separately approved expansion, or disable unsupported overlap cases and preserve
both operands with an actionable diagnostic.

**Verify**: overlapping partial operations never delete an operand unless a valid result is produced.

## Test plan

- Test every gesture under translation, scale, rotation, pivot, and nested groups.
- Add curve/arc bounds and hit fixtures at multiple zoom levels.
- Add primary-button and pointer-cancellation browser tests.
- Replace the Boolean concat test with rejection or exact geometry assertions.

## Done criteria

- [ ] Visible anchors and pointer hit targets coincide under all Android transforms.
- [ ] Single and multi-selection rotation use the visible handle center.
- [ ] Curves/arcs use rendered geometry for bounds and hits.
- [ ] Secondary pointers cannot mutate the document.
- [ ] Incorrect Boolean output cannot be reported as success.
- [ ] All verification commands pass.

## STOP conditions

- Stop if matrix decomposition cannot preserve Android transform order and pivot values.
- Stop before adding a new geometry dependency; present license, bundle, robustness, and curve-flattening trade-offs.
- Stop if fixing a gesture requires changing morph endpoints without an explicit base-vs-keyframe policy.

## Maintenance notes

Keep geometry helpers independent of React. Cache flattened curves by geometry
version so selection performance remains stable as documents grow.
