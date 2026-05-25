# ShapeShifter Angular → React: Full Parity Migration Plan

**Status:** ~70-80% complete. Core path engine, importers/exporters, Zustand state, keyboard shortcuts, command palette, playback, undo/redo, basic UI shell are ported.

**Remaining:** The Paper.js gesture/interaction system (27 gesture files), native SVG renderer overlays (selection bounds, hover, snap guides, cursors), the tool panel, several UI parity gaps (resizable panels, rulers, drag reordering), and CI/tests.

**Architecture:** Replace Paper.js with native SVG renderer (DOM-native, Tailwind-styleable, more accessible). Gesture logic is framework-agnostic and ports cleanly.

**Estimated effort:** ~25-35 focused work sessions.

**Renderer Decision:** Native SVG (current) — confirmed superior for React + Tailwind + Shadcn fit, accessibility, debugging, and existing port investment. Konva and Paper.js rejected.

---

## Phase 0: Foundation (NON-NEGOTIABLE FIRST)

**Goal:** CI pipeline, test coverage for existing code, type safety. No new features until gates pass.

### 0.1 — CI Pipeline (GitHub Actions)
- **Beads issue:** `ci-setup`
- **Files:** `.github/workflows/ci.yml` (new)
- **Acceptance:** PR triggers: `typecheck` → `lint` → `test` → `build`. All 4 pass on Node 20+
- **Risk:** Low

### 0.2 — Expand Vitest Coverage for Existing Modules
- **Beads issues:** `test-editorStore`, `test-exporter`, `test-importers`, `test-interpolators`, `test-project`
- **Files:** `lib/shapeshifter/__tests__/*.test.ts` (new)
- **Acceptance:** Each module has ≥80% branch coverage. Test every action, undo/redo, all 7 export formats, SVG/XML/JSON roundtrip, easing curves, project flattener.
- **Risk:** Low
- **TDD:** Write tests FIRST for each module, run red, then verify existing code passes green

### 0.3 — Parity Audit Checklist
- **Beads issue:** `parity-audit`
- **Files:** All files in `.original-angular/src/app/modules/editor/` vs current
- **Acceptance:** Markdown checklist in `docs/parity-checklist.md` cataloging every original file and its port status (ported / partial / not started). Human-reviewed
- **Risk:** Low

### 0.4 — TypeScript Strictness Gate
- **Beads issue:** `ts-strict`
- **Files:** `tsconfig.json`, all `.ts`/`.tsx` files
- **Acceptance:** `tsc --noEmit` passes with zero errors. No `any` in non-test code
- **Risk:** Medium

**Phase 0 Done =** CI green, existing code tested, full audit map, zero type errors.

---

## Phase 1: Gesture Abstractions + Tool Dispatch

### 1.1 — ToolMode + CursorType Enums
- **Beads issue:** `gesture-enums`
- **Angular source:** `model/paper/ToolMode.ts`, `model/paper/CursorType.ts`
- **React target:** `lib/shapeshifter/toolModes.ts`
- **Acceptance:** `ToolMode` enum: `Default | Pencil | Ellipse | Rectangle | ZoomPan | Select | Rotate | Transform`. `CursorType` union: 27 cursor names. Store updated with `toolMode` field.

### 1.2 — Gesture Base Class
- **Beads issue:** `gesture-base`
- **Angular source:** `scripts/paper/gesture/Gesture.ts`
- **React target:** `lib/shapeshifter/gestures/Gesture.ts`
- **Acceptance:** Abstract class/interface with: `onMouseDown`, `onMouseDrag`, `onMouseMove`, `onMouseUp`, `onKeyDown`, `onKeyUp`. Pure TypeScript, no DOM/Paper.js dependency. Unit test verifying the interface contract.

### 1.3 — Gesture Dispatcher (GestureTool equivalent)
- **Beads issue:** `gesture-dispatcher`
- **Angular source:** `scripts/paper/tool/GestureTool.ts` (277 LOC — the brain)
- **React target:** `lib/shapeshifter/gestures/GestureDispatcher.ts`
- **Acceptance:** On mousedown: inspects `toolMode` + hit-test results + modifier keys → instantiates correct gesture. State machine tested with mocked gestures.
- **Risk:** Medium (most complex routing logic)
- **TDD:** Test dispatch matrix: for each (toolMode, hitResult, modifiers) tuple, assert correct gesture class instantiated.

### 1.4 — Hit Test Utilities
- **Beads issue:** `hit-tests`
- **Angular source:** `scripts/paper/item/HitTests.ts` (92 LOC)
- **React target:** `lib/shapeshifter/gestures/HitTests.ts`
- **Acceptance:** Pure functions: `hitTestSelectionBounds`, `hitTestEditPathSegments`, `hitTestRotatePivot`. All tested against known SVG coordinates.

**Phase 1 Done =** Gesture framework skeleton in place, tested, no visual changes. Store has correct toolMode/cursor state. Dispatcher can route to (empty) gesture stubs.

---

## Phase 2: SVG Renderer Overlays

### 2.1 — Selection Bounds Overlay
- **Beads issue:** `overlay-selection-bounds`
- **Angular source:** `scripts/paper/item/SelectionBoundsRaster.ts`, `PaperLayer.ts`
- **React target:** `components/editor/overlays/SelectionBoundsOverlay.tsx`
- **Acceptance:** Renders 8 draggable handles around selected items. Handles styled identically to original. Cursor changes on hover. Component receives `bounds: Rect`, `onHandleDrag(pivot, delta)`, `visible: boolean`.
- **Risk:** Medium
- **TDD:** Test handle positions for known bounding boxes. Test cursor computation for each pivot angle.

### 2.2 — Edit Path Overlay
- **Beads issue:** `overlay-edit-path`
- **Angular source:** `scripts/paper/item/EditPathRaster.ts`, `PaperLayer.ts`
- **React target:** `components/editor/overlays/EditPathOverlay.tsx`
- **Acceptance:** Renders segment points as circles, bezier handle lines, handle endpoint circles. In "direct" mode, handles labeled "in"/"out". Selected segments highlighted. Extract and complete from existing PathCanvas.tsx.

### 2.3 — Rotation Pivot Overlay
- **Beads issue:** `overlay-rotation-pivot`
- **Angular source:** `scripts/paper/item/RotateItemsPivotRaster.ts`
- **React target:** `components/editor/overlays/RotationPivotOverlay.tsx`
- **Acceptance:** Renders draggable pivot point. Styled identically to original (small circle with crosshair). Drag repositions pivot, updates store.

### 2.4 — Hover Highlight Overlay
- **Beads issue:** `overlay-hover`
- **Angular source:** `PaperLayer.ts` (hover path section), `gesture/hover/HoverItemsGesture.ts`
- **React target:** `components/editor/overlays/HoverOverlay.tsx`
- **Acceptance:** Highlights hovered path/shape with a subtle outline. Cursor changes based on proximity to selection handles. Matches original hover visual exactly.
- **Risk:** Medium

### 2.5 — Snap Guides Overlay
- **Beads issue:** `overlay-snap-guides`
- **Angular source:** `PaperLayer.ts` (snap guides section)
- **React target:** `components/editor/overlays/SnapGuidesOverlay.tsx`
- **Acceptance:** Renders green snap lines when dragging aligns with sibling items. Vertical and horizontal guide lines extend full canvas width/height. Labels showing distance to snap target. Hidden when not snapping.
- **Risk:** Medium

### 2.6 — Custom Cursor System
- **Beads issue:** `custom-cursors`
- **Angular source:** `model/paper/CursorType.ts` (27 cursors)
- **React target:** `lib/shapeshifter/cursors.ts`, cursor SVG assets in `public/cursors/`
- **Acceptance:** All 27 cursor types render correctly. Cursor updates reactively from store `cursorType` state. Cursors match original: resize (0/45/90/135), rotate (0-315 in 45 deg steps), zoom-in/out, grab/grabbing, pen variants, crosshair, pencil.
- **Risk:** Low

**Phase 2 Done =** All visual overlays render as SVG elements in the PathCanvas. Selection bounds, edit path decorations, hover, snap guides, rotation pivot all visible. Custom cursors work.

---

## Phase 3: Selection Gestures (Highest User Impact)

### 3.1 — Select/Drag/Clone Items Gesture
- **Beads issue:** `gesture-select-drag`
- **Angular source:** `gesture/select/SelectDragCloneItemsGesture.ts` (175 LOC)
- **React target:** `lib/shapeshifter/gestures/select/SelectDragItemsGesture.ts`
- **Acceptance:** Click to select item. Drag to move selected items. Shift constrains to 45-degree angles. Alt clones items on drag. Snap-to-sibling alignment. Updates store `selectedLayerIds` and layer transform properties. Matches original behavior exactly.
- **Risk:** Medium
- **TDD:** Test: click selection, drag delta computation, shift-angle constraint, alt-clone produces duplicate layer, boundary conditions.

### 3.2 — Batch Select (Marquee) Gesture
- **Beads issue:** `gesture-marquee`
- **Angular source:** `gesture/select/BatchSelectItemsGesture.ts` (74 LOC)
- **React target:** `lib/shapeshifter/gestures/select/BatchSelectItemsGesture.ts`
- **Acceptance:** Drag draws selection rectangle. Items whose bounds intersect rectangle become selected. Shift adds to existing selection. Alt excludes partial overlaps. Selection rectangle styled identically to original (blue dashed outline with fill). Already partially in PathCanvas.tsx (boxSelection).
- **Risk:** Low
- **TDD:** Test intersection logic: fully inside, partially inside, fully outside, shift-add, alt-exclude.

### 3.3 — Deselect + Edit Path Entry Gestures
- **Beads issue:** `gesture-deselect-editpath`
- **Angular source:** `gesture/select/DeselectItemGesture.ts` (25 LOC), `gesture/select/EditPathGesture.ts` (33 LOC)
- **React target:** `lib/shapeshifter/gestures/select/DeselectItemGesture.ts`, `EditPathGesture.ts`
- **Acceptance:** Deselect: shift-click on selected item removes it from selection. Edit path: double-click on path enters edit-path mode, shows segment/handle overlays. Both match original behavior.
- **Risk:** Low

**Phase 3 Done =** Full selection parity. Users can select, deselect, multi-select (marquee + shift-click), move, and clone items. Double-click enters edit path mode.

---

## Phase 4: Transform Gestures

### 4.1 — Scale Items Gesture
- **Beads issue:** `gesture-scale`
- **Angular source:** `gesture/scale/ScaleItemsGesture.ts` (253 LOC)
- **React target:** `lib/shapeshifter/gestures/scale/ScaleItemsGesture.ts`
- **Acceptance:** Drag selection bounds handles to scale. Alt = scale from center. Shift = maintain aspect ratio. Snap guides shown when scaling aligns to siblings. Minimum scale prevents flipping. Works on single and multi-selected items.
- **Risk:** High (complex math + snap integration)
- **TDD:** Test: scale delta computation for each of 8 pivot handles, center-scale mode, aspect-ratio constraint, snap integration, minimum scale clamp.

### 4.2 — Rotate Items Gesture
- **Beads issue:** `gesture-rotate`
- **Angular source:** `gesture/rotate/RotateItemsGesture.ts` (125 LOC), `RotateItemsDragPivotGesture.ts` (63 LOC)
- **React target:** `lib/shapeshifter/gestures/rotate/RotateItemsGesture.ts`, `RotateItemsDragPivotGesture.ts`
- **Acceptance:** Drag to rotate items around pivot point. Shift snaps to 15-degree increments. Pivot point visible and draggable to reposition. Rotation updates layer transform in store.
- **Risk:** Medium
- **TDD:** Test: rotation angle computation, 15-degree snap, pivot drag repositioning, rotation of multi-selected items.

### 4.3 — Transform Paths Gesture (Perspective Distort)
- **Beads issue:** `gesture-transform`
- **Angular source:** `gesture/transform/TransformPathsGesture.ts` (141 LOC), `scripts/common/TransformUtil.ts` (195 LOC)
- **React target:** `lib/shapeshifter/gestures/transform/TransformPathsGesture.ts`
- **Acceptance:** Drag 4 corner handles of selection bounds to apply perspective distortion. Uses LU decomposition (already in `mathUtils.ts` as `distort()`). Updates path data directly (not transform properties). Matches original distort behavior.
- **Risk:** Medium (LU decomposition already ported, but integration with gesture is new)

**Phase 4 Done =** Full transform parity. Scale, rotate, perspective-distort all work via selection bounds handles with correct modifier key behavior.

---

## Phase 5: Path/Curve Editing Gestures

### 5.1 — Select/Drag/Draw Segments Gesture
- **Beads issue:** `gesture-segments`
- **Angular source:** `gesture/edit/SelectDragDrawSegmentsGesture.ts` (243 LOC — MOST COMPLEX)
- **React target:** `lib/shapeshifter/gestures/edit/SelectDragDrawSegmentsGesture.ts`
- **Acceptance:** Three factory methods: (1) `hitSegment` — click/drag existing segment, (2) `hitCurve` — click on curve to split it and drag the new point, (3) `miss` — click on empty space to create new path or extend open path. Auto-closes path when clicking near start point. Snap to other segments. All three modes tested independently.
- **Risk:** High (most complex single gesture, 4 interaction modes)
- **TDD:** Test each factory method: segment drag, curve split + drag, new path creation, path extension, auto-close detection, snap-to-segment.

### 5.2 — Drag Handle Gesture
- **Beads issue:** `gesture-handle-drag`
- **Angular source:** `gesture/edit/SelectDragHandleGesture.ts` (96 LOC)
- **React target:** `lib/shapeshifter/gestures/edit/SelectDragHandleGesture.ts`
- **Acceptance:** Drag bezier in/out handles. Shift constrains handle to original vector direction. Updates path command's control points in store. Already partially implemented in PathCanvas.tsx point drag — verify parity.
- **Risk:** Low

### 5.3 — Batch Select Segments + Mould Curve + Toggle Handles
- **Beads issue:** `gesture-edit-extras`
- **Angular source:** `BatchSelectSegmentsGesture.ts` (101 LOC), `MouldCurveGesture.ts` (147 LOC), `ToggleSegmentHandlesGesture.ts` (35 LOC)
- **React target:** `lib/shapeshifter/gestures/edit/BatchSelectSegmentsGesture.ts`, `MouldCurveGesture.ts`, `ToggleSegmentHandlesGesture.ts`
- **Acceptance:** Batch select: marquee selects multiple segments in edit-path mode, shift/cmd toggle. Mould curve: drag a point on a curve to reshape using Bezier hull math. Toggle handles: double-click segment toggles smooth/corner. All match original.
- **Risk:** Medium

**Phase 5 Done =** Full path editing parity. Users can select/drag segments, drag bezier handles, split curves, extend paths, create new paths, mould curves, toggle handles, batch select segments.

---

## Phase 6: Shape Creation Gestures

### 6.1 — Shape Creation Gestures
- **Beads issue:** `gesture-shapes`
- **Angular source:** `create/ShapeGesture.ts` (77 LOC), `RectangleGesture.ts` (11 LOC), `EllipseGesture.ts` (11 LOC), `PencilGesture.ts` (74 LOC)
- **React target:** `lib/shapeshifter/gestures/create/ShapeGesture.ts`, `RectangleGesture.ts`, `EllipseGesture.ts`, `PencilGesture.ts`
- **Acceptance:** Drag to create rectangle/ellipse. Shift = constrain to square/circle. Alt = draw from center. Escape = cancel. Pencil: freehand drawing with path smoothing, auto-close when near start point. All create new layers in store. Preview shown during drag. Matches original behavior.
- **Risk:** Medium
- **TDD:** Test: rectangle creation with/without shift/alt, ellipse creation, pencil path smoothing, auto-close detection, escape cancellation, store layer creation.

**Phase 6 Done =** Users can draw rectangles, ellipses, and freehand paths. All modifier keys work correctly.

---

## Phase 7: Snap System

### 7.1 — Snap Engine
- **Beads issue:** `snap-engine`
- **Angular source:** `util/snap/SnapUtil.ts` (335 LOC), `SnapBounds.ts` (55 LOC), `Constants.ts` (15 LOC)
- **React target:** `lib/shapeshifter/snap/SnapUtil.ts`, `SnapBounds.ts`, `constants.ts`
- **Acceptance:** `computeSnapDelta(position, bounds, siblingBounds[])` returns `{delta, guideLines}`. Snap threshold matches original (snap to edges + centers of sibling items). Guide lines computed for vertical + horizontal axes. Pure functions, no DOM dependency. Integrated with SelectDragItemsGesture, ScaleItemsGesture, SelectDragDrawSegmentsGesture.
- **Risk:** Medium
- **TDD:** Test: snap to left edge, right edge, center, top, bottom, no-snap when below threshold, multiple guide lines, snap to nearest when multiple candidates.

**Phase 7 Done =** Snap-to-sibling works for drag, scale, and segment drag operations. Green guide lines appear. Matches original snap behavior.

---

## Phase 8: Hover System

### 8.1 — Hover Gesture System
- **Beads issue:** `gesture-hover`
- **Angular source:** `hover/HoverGesture.ts` (52 LOC), `HoverItemsGesture.ts` (89 LOC), `HoverSegmentsCurvesGesture.ts` (201 LOC)
- **React target:** `lib/shapeshifter/gestures/hover/HoverGesture.ts`, `HoverItemsGesture.ts`, `HoverSegmentsCurvesGesture.ts`
- **Acceptance:** Default mode: cursor changes to resize/rotate/transform when hovering over selection bounds handles. Sets `hoveredLayerId` in store. Edit-path mode: shows split-curve preview (dot on curve), extend-path preview (dot at cursor), pen cursors (pen-add, pen-close). Handles delete of hovered/selected segments. Hover gesture is restored as active gesture after every mouseUp. Matches original exactly.
- **Risk:** Medium

**Phase 8 Done =** Full hover parity. Cursor changes contextually, split/extend previews show, hover highlights work.

---

## Phase 9: Click Detection + Zoom/Pan Tool

### 9.1 — Click Detector
- **Beads issue:** `click-detector`
- **Angular source:** `detector/ClickDetector.ts` (85 LOC), `Handler.ts` (28 LOC)
- **React target:** `lib/shapeshifter/gestures/ClickDetector.ts`
- **Acceptance:** Distinguishes single vs double click. Single click selects, double click enters edit-path mode. 300ms timeout. Pure function/class, no DOM dependency.
- **Risk:** Low

### 9.2 — Zoom/Pan Tool
- **Beads issue:** `tool-zoom-pan`
- **Angular source:** `tool/ZoomPanTool.ts` (108 LOC)
- **React target:** `lib/shapeshifter/gestures/ZoomPanTool.ts`
- **Acceptance:** Click zooms in, alt+click zooms out. Space+drag pans. Matches existing PathCanvas zoom/pan behavior (already partially implemented — verify parity and integrate with gesture framework).
- **Risk:** Low

---

## Phase X: UI Parity Sweep

### X.1 — Tool Panel (Left Sidebar)
- **Beads issue:** `ui-tool-panel`
- **Angular source:** `components/toolpanel/toolpanel.component.html`
- **React target:** `components/editor/ToolPanel.tsx` (new)
- **Acceptance:** Left sidebar with 8 tool buttons: Select, Rotate, Transform, Pencil, Vector (edit path), Oval, Rectangle, Zoom/Pan. Active tool highlighted. Tooltips on hover. Icons match original Material icons. Integrated with `toolMode` store state. Collapsible.

### X.2 — Resizable Panels (Splitters)
- **Beads issue:** `ui-splitters`
- **Angular source:** `components/splitter/splitter.component.ts`
- **React target:** Update `app/page.tsx` layout to use `react-resizable-panels` (already in deps)
- **Acceptance:** Inspector panel resizable (min 200px). Layer timeline height resizable from top. Layer list width resizable from right. Drag handle styled identically to original (thin line, cursor changes to resize on hover).

### X.3 — Canvas Rulers
- **Beads issue:** `ui-rulers`
- **Angular source:** `components/canvas/canvasruler.directive.ts`
- **React target:** `components/editor/overlays/CanvasRuler.tsx` (new)
- **Acceptance:** Horizontal ruler at top of canvas, vertical ruler at left. Tick marks at viewport pixel intervals. Numbers at major intervals. Ruler scrolls with canvas pan/zoom. Styled to match original.
- **Risk:** Medium

### X.4 — Layer Drag Reordering
- **Beads issue:** `ui-layer-drag`
- **Angular source:** `layertimeline/layertimeline.component.html` (drag indicator)
- **React target:** Update `LayerTimeline.tsx` layer list
- **Acceptance:** Drag layers to reorder in the list. Visual drag indicator line shows drop position. Reorder updates store layer order. Matches original drag behavior.
- **Risk:** Medium

### X.5 — Pair SubPaths (Complete the Stub)
- **Beads issue:** `feature-pair-subpaths`
- **Angular source:** `components/canvas/PairSubPathHelper.ts`, `services/actionmode.service.ts` (pairing section)
- **React target:** `lib/shapeshifter/pairSubPaths.ts` (new), update `editorStore.ts`
- **Acceptance:** Full pairing workflow: select subpaths on from/to sides, pair them for morphing. UI guidance messages match original. Currently stubbed in toolbar.
- **Risk:** Medium

### X.6 — Inspector Block/Animation Properties
- **Beads issue:** `ui-inspector-parity`
- **Angular source:** `components/propertyinput/propertyinput.component.html`
- **React target:** Update `Inspector.tsx`
- **Acceptance:** When timeline block selected: show interpolator, start/end time, from/to value editors. When animation header selected: show name, duration editors. Path incompatibility messages match original detail level. "Animate this layer" dropdown with available property names. "Edit path morphing" button for PathAnimationBlocks.

### X.7 — Scroll Sync + Timeline Scrubbing
- **Beads issue:** `ui-timeline-parity`
- **Angular source:** `components/scrollgroup/scrollgroup.directive.ts`, `layertimeline/layertimelinegrid.directive.ts`
- **React target:** Update `LayerTimeline.tsx`
- **Acceptance:** Layer list and timeline scroll vertically in sync. Timeline header is clickable/scrubbable to set playback position. Matches original scrubbing behavior.
- **Risk:** Medium

### X.8 — Dialogs Parity
- **Beads issue:** `ui-dialogs`
- **Angular source:** `dialogs/demodialog.component.ts`, `confirmdialog.component.ts`, `dropfilesdialog.component.ts`
- **React target:** New dialog components or update existing
- **Acceptance:** Demo picker: radio button list with OK/Cancel. Confirm dialog: for destructive actions (delete layer, reset workspace). Drop files dialog: "Add layers" vs "Start from scratch" choice on file drop.

### X.9 — Overflow Menu Parity
- **Beads issue:** `ui-overflow-menu`
- **Angular source:** `toolbar/toolbar.component.html` (overflow menu)
- **React target:** Update `Toolbar.tsx`
- **Acceptance:** Overflow menu contains: theme toggle, "Getting Started" link, "Contribute" (GitHub link), "Send Feedback" (GitHub issues link). Currently only has theme toggle and shortcuts.

**Phase X Done =** Every UI element from the original Angular app is present and behaving identically.

---

## Phase Y: Polish + Extras

### Y.1 — Playwright Visual Diff Tests
- **Beads issue:** `e2e-visual-diff`
- **Files:** `e2e/` (new directory)
- **Acceptance:** Playwright tests load each demo from the original, screenshot the React app at key interaction states, compare against reference screenshots. CI blocks on visual regression >1% pixel diff.
- **Risk:** Medium

### Y.2 — Performance: Gesture Throttle + React.memo
- **Beads issue:** `perf-gestures`
- **Acceptance:** Mouse drag events throttled to 60fps. Overlay components wrapped in React.memo with proper comparison. SVG path rendering memoized when path data unchanged. No frame drops during continuous drag on 4K display.

### Y.3 — Accessibility
- **Beads issue:** `a11y`
- **Acceptance:** All interactive elements keyboard-accessible. Canvas has aria-label describing current state. Tool panel buttons have aria-pressed states. Focus ring visible on all controls. Screen reader announces tool mode changes.

### Y.4 — Hidden Extras (OK per requirements)
- **Beads issues:** `extra-command-palette-actions`, `extra-url-loading`, `extra-offline`
- **Acceptance:** Command palette includes all gesture/tool actions. URL parameter project loading works. PWA/service worker for offline support (optional). These are extras that don't affect parity.

---

## Atomic Commit Strategy

Every commit follows this pattern:

```
<scope>(<module>): <imperative description>

- Specific change 1
- Specific change 2

Test: <what was tested>
Refs: #<beads-issue-id>
```

**One commit per beads issue.** If an issue is large (e.g., `gesture-segments`), break into sub-commits per factory method.

**TDD cycle per commit:**
1. Write failing test for the specific behavior
2. Implement minimum code to pass
3. Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
4. Commit only when all 4 gates pass

---

## Verification Gates (Every Commit)

```bash
pnpm typecheck   # Zero TypeScript errors
pnpm lint        # Zero oxlint warnings
pnpm test        # All vitest tests pass
pnpm build       # Next.js builds successfully
```

These are **non-negotiable**. If any gate fails, the commit is blocked.

---

## Dependency Graph (Execution Order)

```
Phase 0 (Foundation)
  ↓
Phase 1 (Gesture Abstractions)
  ↓
Phase 2 (SVG Overlays) ← can start 1.1/1.2 in parallel
  ↓
Phase 3 (Selection) ← depends on 1.3, 1.4, 2.1, 2.4
  ↓
Phase 4 (Transforms) ← depends on 3.1, 2.1, 2.3
  ↓
Phase 5 (Path Editing) ← depends on 3.1, 2.2, 1.4
  ↓
Phase 6 (Shape Creation) ← depends on 1.3
  ↓
Phase 7 (Snap) ← depends on 3.1, 4.1, 5.1
  ↓
Phase 8 (Hover) ← depends on 1.3, 2.4, 2.2
  ↓
Phase 9 (Click + ZoomPan) ← independent, can run early
  ↓
Phase X (UI Parity) ← can start X.1/X.2/X.8 after Phase 1
  ↓
Phase Y (Polish) ← after all above
```

Phases 9 and X can partially overlap with Phases 2-8. Within Phase X, items X.1-X.9 are independent.

---

## Beads Issues Summary (Create Order)

| # | Issue ID | Phase | Priority | Description |
|---|----------|-------|----------|-------------|
| 1 | `ci-setup` | 0 | Critical | GitHub Actions CI pipeline |
| 2 | `test-editorStore` | 0 | Critical | Test Zustand store actions |
| 3 | `test-exporter` | 0 | Critical | Test 7 export formats |
| 4 | `test-importers` | 0 | Critical | Test SVG/XML/JSON import |
| 5 | `test-interpolators` | 0 | High | Test easing curves |
| 6 | `test-project` | 0 | High | Test project loader |
| 7 | `parity-audit` | 0 | High | Complete port status checklist |
| 8 | `ts-strict` | 0 | High | Zero TypeScript errors |
| 9 | `gesture-enums` | 1 | High | ToolMode + CursorType enums |
| 10 | `gesture-base` | 1 | High | Gesture abstract class |
| 11 | `gesture-dispatcher` | 1 | Critical | Central gesture routing |
| 12 | `hit-tests` | 1 | High | Hit test utilities |
| 13 | `overlay-selection-bounds` | 2 | High | Selection bounds overlay |
| 14 | `overlay-edit-path` | 2 | High | Edit path overlay |
| 15 | `overlay-rotation-pivot` | 2 | Medium | Rotation pivot overlay |
| 16 | `overlay-hover` | 2 | High | Hover highlight overlay |
| 17 | `overlay-snap-guides` | 2 | Medium | Snap guides overlay |
| 18 | `custom-cursors` | 2 | Medium | 27 custom cursors |
| 19 | `gesture-select-drag` | 3 | Critical | Select/drag/clone gesture |
| 20 | `gesture-marquee` | 3 | High | Marquee selection gesture |
| 21 | `gesture-deselect-editpath` | 3 | High | Deselect + edit path entry |
| 22 | `gesture-scale` | 4 | High | Scale gesture |
| 23 | `gesture-rotate` | 4 | High | Rotate gesture + pivot drag |
| 24 | `gesture-transform` | 4 | Medium | Perspective distort gesture |
| 25 | `gesture-segments` | 5 | Critical | Segment select/drag/draw |
| 26 | `gesture-handle-drag` | 5 | High | Bezier handle drag |
| 27 | `gesture-edit-extras` | 5 | Medium | Batch select + mould + toggle |
| 28 | `gesture-shapes` | 6 | High | Rectangle/Ellipse/Pencil creation |
| 29 | `snap-engine` | 7 | High | Snap computation engine |
| 30 | `gesture-hover` | 8 | High | Hover gesture system |
| 31 | `click-detector` | 9 | Medium | Single/double click detection |
| 32 | `tool-zoom-pan` | 9 | Medium | Zoom/Pan tool |
| 33 | `ui-tool-panel` | X | High | Left tool panel sidebar |
| 34 | `ui-splitters` | X | High | Resizable panel splitters |
| 35 | `ui-rulers` | X | Medium | Canvas rulers |
| 36 | `ui-layer-drag` | X | Medium | Layer drag reordering |
| 37 | `feature-pair-subpaths` | X | High | Complete pair subpaths |
| 38 | `ui-inspector-parity` | X | Medium | Inspector block/animation props |
| 39 | `ui-timeline-parity` | X | Medium | Scroll sync + timeline scrub |
| 40 | `ui-dialogs` | X | Low | Dialog parity |
| 41 | `ui-overflow-menu` | X | Low | Overflow menu parity |
| 42 | `e2e-visual-diff` | Y | High | Playwright visual regression |
| 43 | `perf-gestures` | Y | Medium | Gesture performance |
| 44 | `a11y` | Y | Medium | Accessibility |
| 45 | `extra-command-palette` | Y | Low | Extended command palette |
| 46 | `extra-url-loading` | Y | Low | URL parameter loading |

**Total: 46 beads issues across 10 phases + polish.**

---

## "Done" Definition

The migration is **done** when ALL of the following are true:

1. **Every original Angular file** in `parity-checklist.md` is marked "ported" or "intentionally omitted" (with justification)
2. **All 46 beads issues** are closed
3. **CI is green**: `typecheck` + `lint` + `test` + `build` all pass
4. **Visual parity**: Playwright screenshots of React app running each demo match reference screenshots from the original Angular app (pixel diff < 1%)
5. **Behavioral parity**: Every interaction documented in the original README (path morphing, auto fix, point add/remove, reverse/shift, shape drawing, transform, export) works identically in the React app
6. **No regressions**: All existing tests continue to pass, no TypeScript errors
7. **Pushed to remote**: `git status` shows "up to date with origin"

---

**Plan persisted:** `.sisyphus/plans/migration-full-parity.md`

**Next:** Create 46 beads issues via `bd create`, then begin Phase 0.
