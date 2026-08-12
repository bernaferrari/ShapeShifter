# Plan 003: Build one Android-faithful evaluated scene

> **Executor instructions**: Implement a single pure scene evaluator and migrate
> consumers incrementally. Do not patch each canvas independently. Stop on a STOP
> condition and update Plan 003 in `plans/README.md` when complete.
>
> **Drift check**: `git diff --stat 3268b817..HEAD -- lib/shapeshifter/scene components/editor/canvas components/editor/PathCanvas.tsx lib/shapeshifter/androidCompiler.ts`

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 001 and 002
- **Category**: architecture
- **Planned at**: commit `3268b817`, 2026-08-12

## Why this matters

Android VectorDrawable is an ordered tree of groups, paths, and clip paths.
Currently the world canvas flattens that tree, the detail canvas partially walks
parents, and the Android compiler rebuilds hierarchy separately. One evaluator
must define Android transform order, clipping scope, visibility, appearance, and
playhead state for every consumer.

## Current state

- `lib/shapeshifter/scene/render.ts:25-95` maps a flat layer array.
- `components/editor/canvas/WorldArtboards.tsx:276-292` renders every draw as a sibling.
- `lib/shapeshifter/scene/hitTest.ts:24-104` ignores ancestor transforms and clipping.
- `lib/shapeshifter/scene/selection.ts:27-50` uses static source geometry.
- `components/editor/canvas/pathCanvasPreview.ts:76` has a separate parent-chain implementation.
- `lib/shapeshifter/androidCompiler.ts:244-309` independently reconstructs the Android hierarchy.
- Android applies group transforms in scale → rotate → translate order; preserve the
  semantics defined by the Android VectorDrawable contract.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Scene tests | `pnpm test -- lib/shapeshifter/__tests__/sceneRender.test.ts lib/shapeshifter/__tests__/sceneHitTest.test.ts lib/shapeshifter/__tests__/sceneSelection.test.ts lib/shapeshifter/__tests__/androidParity.test.ts` | all pass |
| Full suite | `pnpm test` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Build | `pnpm build` | exit 0 |

## Scope

**In scope**:

- `lib/shapeshifter/scene/`
- `components/editor/canvas/WorldArtboards.tsx`
- `components/editor/canvas/pathCanvasPreview.ts`
- `components/editor/PathCanvas.tsx`
- `lib/shapeshifter/androidCompiler.ts` only to consume shared hierarchy/evaluation data
- Scene and Android parity tests

**Out of scope**:

- Direct editing gesture implementation
- Timeline UI redesign
- Non-Android effects or blend modes
- Auto layout or responsive frame behavior

## Steps

### Step 1: Define the evaluated Android scene API

Create a pure evaluator returning ordered nodes with:

- stable node ID and Android target name;
- node kind: vector root, group, path, or clip path;
- parent ID, ordered children, and depth;
- local and composed affine matrices following Android group transform order;
- inherited visibility and effective alpha;
- evaluated geometry and every supported path appearance property;
- active clip scope as defined by preceding clip paths within a group;
- source references for selection and diagnostics.

The evaluator must accept an artboard plus absolute playhead time. It must not
depend on React or mutate store objects.

**Verify**: unit tests cover nested transforms and sibling-order clip scope.

### Step 2: Render both canvases from evaluated nodes

Remove divergent property resolution and parent walking from the canvas components.
Emit nested SVG groups/clip definitions that visually match Android semantics.
Implement fill/stroke alpha, vector alpha, stroke width/cap/join/miter, fill type,
dash only when deliberately retained as a non-exportable preview feature, and
trim-path rendering using measured path length.

**Verify**: parity fixtures render equivalent evaluated attributes in both canvas modes.

### Step 3: Route hit testing, bounds, and overlays through the evaluator

Use evaluated geometry and composed matrices at the current playhead. Respect
visibility, locks, clip scope, path fill type, stroke width, and trim where practical.
Return stable source node IDs.

**Verify**: tests select transformed nested paths at nonzero playhead time and reject clipped-out geometry.

### Step 4: Make the Android compiler consume the same ordered scene contract

The compiler may serialize unevaluated base values plus tracks, but hierarchy,
names, clip ordering, transforms, styles, and visibility must originate from the
same canonical traversal used by preview.

**Verify**: the Plan 001 hierarchy and clip expected failures become normal tests.

## Test plan

- Nested group with nonzero pivot, nonuniform scale, rotation, and translation.
- Clip path affecting later siblings but not preceding or outside-group nodes.
- Hidden/locked ancestor behavior.
- Path at start, middle, end, and after animation.
- Trimmed stroke and fill-rule selection.
- World/detail/compiler node-order parity.

## Done criteria

- [ ] One evaluator owns hierarchy, matrices, clipping, appearance, and playhead geometry.
- [ ] Both browser canvases render the same evaluated scene.
- [ ] Hit tests and selection bounds use the displayed scene.
- [ ] Compiler traversal does not independently reinterpret hierarchy.
- [ ] All verification commands pass.

## STOP conditions

- Stop if Android clip-path ordering cannot be represented by the current node order without data loss.
- Stop if matrix decomposition would alter authored Android transform values; preserve raw local values and compose only for evaluation.
- Stop if a canvas-specific feature requires changing Android semantics; isolate and label it instead.

## Maintenance notes

This evaluator is the semantic center of the product. Future preview, export,
thumbnail, onion skin, smart guide, and selection work must consume it rather than
reimplementing document traversal.

