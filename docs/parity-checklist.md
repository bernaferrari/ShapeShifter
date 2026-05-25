# ShapeShifter Angular → React Parity Checklist

**Purpose**: Track 100% behavioral and UI parity between the original Angular 7 app (in `.original-angular/`) and the current Next.js + React 19 + Tailwind + Shadcn port.

**Status Legend**:
- ✅ Ported — Feature/behavior/UI matches original exactly (verified by test + manual/QA)
- 🔄 In Progress — Work underway in a beads issue
- ⚠️ Partial — Core works but edge cases, visuals, or interactions differ
- ❌ Not Started — No equivalent in React port yet
- 🚫 Intentionally Omitted — Decision documented with justification (e.g., demo dialogs, PWA)

**Last Updated**: 2026-05-24 (start of full parity push)
**Reference Plan**: `.sisyphus/plans/migration-full-parity.md`

---

## Phase 0 — Foundation

| Original Location | React Equivalent | Status | Notes / Beads ID |
|-------------------|------------------|--------|------------------|
| N/A (new CI) | `.github/workflows/ci.yml` | ✅ | ShapeShifter-44x closed |
| Tests (9 spec files) | `lib/shapeshifter/__tests__/` + new store tests | 🔄 | 4 test issues in progress (i0i, kmu, 5bk, m9l, 9ys) |
| No strict TS | `tsconfig.json` + fixes | 🔄 | ts-strict (gji) |
| No parity doc | `docs/parity-checklist.md` (this file) | 🔄 | parity-audit (1km) |

---

## Core Path Engine & Math (High Fidelity)

| Original | React | Status | Notes |
|----------|-------|--------|-------|
| `scripts/common/MathUtil.ts`, `Matrix.ts`, `Rect.ts`, `TransformUtil.ts`, `ColorUtil.ts` | `lib/shapeshifter/mathUtils.ts` (73 tests) | ✅ | Ported in earlier work (w0-t4) |
| `PathParser`, `PathSerializer` | `lib/shapeshifter/pathUtils.ts` (parsePath, pathToString, etc.) | ⚠️ | 9 pre-existing test failures in roundtrip/reverse/shift (being addressed by test coverage) |
| Needleman-Wunsch + AutoAwesome | `autoFixPathPair` in pathUtils | ✅ | High-fidelity port |
| All interpolators (5 easings) | `lib/shapeshifter/interpolators.ts` | 🔄 | Test coverage pending (m9l) |

---

## Paper.js Gesture System (The Big Gap — 92 original script files)

**Architecture Decision**: Native SVG renderer (not Paper.js, not Konva). Gesture logic reimplemented as framework-agnostic classes in `lib/shapeshifter/gestures/`.

### Phase 1 — Abstractions
- ToolMode + CursorType enums → `lib/shapeshifter/toolModes.ts` — ❌
- Gesture base class → `lib/shapeshifter/gestures/Gesture.ts` — ❌
- GestureDispatcher (the brain, ~277 LOC from GestureTool) — ❌ (ShapeShifter-???)
- HitTests utilities — ❌

### Phase 2 — SVG Renderer Overlays (replacing PaperLayer 779 LOC)
- SelectionBoundsOverlay — ❌
- EditPathOverlay (segments + handles) — ⚠️ Partial (exists in PathCanvas but incomplete)
- RotationPivotOverlay — ❌
- HoverOverlay — ❌
- SnapGuidesOverlay — ❌
- Custom 27 cursors — ❌

### Phase 3 — Selection Gestures (Highest user impact)
- SelectDragCloneItemsGesture (175 LOC) — ❌
- BatchSelectItemsGesture (marquee) — ⚠️ Partial (boxSelection exists in PathCanvas)
- Deselect + EditPath entry — ❌

### Phase 4 — Transform Gestures
- ScaleItemsGesture (253 LOC — complex) — ❌
- RotateItemsGesture + pivot drag — ❌
- TransformPathsGesture (perspective distort) — ❌

### Phase 5 — Path/Curve Editing (Most complex)
- SelectDragDrawSegmentsGesture (243 LOC — MOST COMPLEX) — ❌
- SelectDragHandleGesture — ⚠️ Partial (some point dragging works)
- BatchSelectSegments + MouldCurve + ToggleHandles — ❌

### Phase 6 — Shape Creation
- Rectangle / Ellipse / Pencil gestures — ❌ (basic tools exist, full gestures missing)

### Phase 7 — Snap System
- SnapUtil (335 LOC) + SnapBounds — ❌

### Phase 8 — Hover System
- HoverItemsGesture, HoverSegmentsCurvesGesture (201 LOC) — ❌

### Phase 9 — Click + Zoom/Pan
- ClickDetector — ❌
- ZoomPanTool — ⚠️ Partial (PathCanvas has zoom/pan, not integrated with gesture framework yet)

**Overall Gesture System Status**: ~15-20% ported (basic direct manipulation works; advanced gestures not yet reimplemented).

---

## State Management

| Original | React | Status | Notes |
|----------|-------|--------|-------|
| 30 NgRx files across 8 domains | Single `lib/store/editorStore.ts` (986 LOC, Zustand + undo/redo) | ⚠️ | Functional but untested. Full coverage in progress (i0i) |
| History stack | Built into store (pushHistory) | ⚠️ | Needs tests |

---

## Importers & Exporters

| Format | Original | React | Status |
|--------|----------|-------|--------|
| SVG Import | SVG parser + SVGO plugins | In progress | Test coverage pending (5bk) |
| VectorDrawable XML | XML importer | In progress | Test coverage pending |
| .shapeshifter project | ProjectService | In progress | Test coverage pending |
| SVG Export | Exporter | In progress | Test coverage pending (kmu) |
| CSS Keyframes, AVD, Lottie, JSON, Spritesheet, Project | Exporter | In progress | Test coverage pending |

---

## UI Components Parity

### Major Components
| Original Component | React Equivalent | Status | Notes |
|--------------------|------------------|--------|-------|
| Toolbar | `components/editor/Toolbar.tsx` | ⚠️ | Basic actions present, overflow menu incomplete, tool panel missing |
| LayerTimeline + drag reordering | `components/editor/LayerTimeline.tsx` | ⚠️ | Drag blocks partially implemented; scroll sync + scrubbing missing |
| Inspector (propertyinput) | `components/editor/Inspector.tsx` | ⚠️ | Basic, missing full block/animation editors and "Animate this layer" dropdown |
| Canvas + PaperLayer | `components/editor/PathCanvas.tsx` + overlays | ⚠️ | Core rendering + some direct manipulation works; overlays and advanced gestures missing |
| Splitter (resizable panels) | `react-resizable-panels` (already in deps) | ❌ | Not yet wired for inspector / timeline heights |
| CanvasRuler | None | ❌ | Not ported |
| Playback controls | Integrated in timeline / toolbar | ⚠️ | Basic play/pause/progress in store; UI parity incomplete |
| Tool Panel (left sidebar with 8 tools) | None | ❌ | Critical missing piece for toolMode switching |
| Dialogs (demo, confirm, drop files) | None or using shadcn | ❌ | Demo picker and confirm flows missing |
| Splashscreen | None | 🚫 | Intentionally omitted (modern web app) |

### Other UI
- Command palette (⌘K) — ✅ (new feature, not in original — good extra)
- Dark/light theme with Shadcn tokens — ✅
- Keyboard shortcuts — ✅ (extensive parity achieved in prior work)
- Drag & drop file import — ✅

---

## Advanced / Niche Features

| Feature | Original Location | React Status |
|---------|-------------------|--------------|
| Pair SubPaths (for morphing) | PairSubPathHelper.ts + actionmode.service | ⚠️ Stub in toolbar, full workflow missing (X.5) |
| Action Mode / Edit Path full parity | Many canvas + gesture files | 🔄 Major ongoing effort (multiple phases) |
| SVGO preprocessing plugins (convertRoundedRect, replaceUse) | SVGO plugins | ❌ Low priority |
| Service Worker / PWA | Original config | 🚫 Intentionally low priority |
| Demo dialog + sample loader | demos/ + demodialog | 🚫 Optional extra |
| E2E tests (Protractor → Playwright) | None | ❌ Phase Y |

---

## Known Gaps Requiring New Beads Issues (Beyond Current 46)

- Full integration of gesture framework with PathCanvas (hit testing on real SVG elements)
- Performance: gesture throttling, React.memo on overlays during 60fps drag
- Accessibility audit (canvas aria, keyboard navigation for tools)
- Visual regression baseline (Playwright + reference screenshots from original)

---

## "Done" Criteria (from migration plan)

The migration is complete only when:

1. Every row in this checklist is ✅ or 🚫 (with justification)
2. All 46 beads issues are closed
3. CI is fully green (`typecheck && lint && test && build`)
4. Playwright visual diffs < 1% pixel difference on key demos
5. Behavioral parity verified for documented original features (morphing, auto-fix, reverse/shift, shape tools, transforms, exports)
6. No regressions in existing passing tests
7. `git status` clean and pushed

---

**Next Actions**:
- Complete Phase 0 test coverage (5 open issues)
- Run `ts-strict` cleanup
- Begin Phase 1 gesture abstractions once foundation is green

This document will be updated after every closed beads issue.
