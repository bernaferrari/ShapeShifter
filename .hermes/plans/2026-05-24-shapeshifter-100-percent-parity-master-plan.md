# ShapeShifter 100% Angular Feature Parity Port - Master Implementation Plan

> **For Hermes:** Use subagent-driven-development skill + delegate_task to implement this plan task-by-task across waves. Maintain live `todo` tool for runtime tracking. Update bd issues in parallel with code work. Close waves only after verification against original in `.original-angular`.

**Goal:** Achieve 100% faithful port of all core functionality, behavior, and professional UX from the 2017 Angular ShapeShifter (interactive SVG path morphing tool with Action Mode direct manipulation, full animation timeline, groups/clipPaths, complete import/export, dialogs, keyboard, etc.) into the modern React/Next.js + Tailwind + shadcn + Zustand implementation. Extras (better visuals, modern interactions) allowed and encouraged, but **zero missing original features**.

**Current Context (as of 2026-05-24):**
- Original source preserved in `.original-angular/` (do not modify).
- bd epic `ShapeShifter-7uu` + 20+ child waves/issues tracking all gaps (P0 waves for Path Core, Canvas, Timeline, Toolbar, Dialogs/Inspector/IO, Polish, Verification).
- Major progress already landed:
  - Path engine + high-fidelity Needleman-Wunsch AutoFix (ported from AutoAwesome.ts + NeedlemanWunsch.ts).
  - Canvas Action Mode: toolMode (Select/Pen/Direct), direct bezier handles + lines, full multi-point box selection + shift additive, group uniform translate drag with snap (Pure SVG strategy, no paper.js).
  - Toolbar: many original actions wired (Reverse, Shift, AutoFix, Split, Set First, Delete Point/SubPath, Pair placeholder).
  - Keyboard: comprehensive shortcuts including tool switches, magic tools, delete, undo, playback.
  - LayerTimeline: basic hierarchy + add blocks + **recent interactive draggable blocks with 50ms snap + per-block interpolator picker**.
- Remaining critical gaps (from `bd ready` + code audit):
  - Full interactive LayerTimeline (resize blocks, full grid snapping, playback scrubbing driving preview, multi-select transforms).
  - Groups, ClipPaths, Layer hierarchy, transforms, nested rendering, Property Inspector parity (127/977).
  - Complete Import (SVG with <use>, complex Vector Drawable, .shapeshifter project format, drag-drop, error recovery) + Export (all original formats + modern).
  - Dialogs/Splash/Confirm/Demo flows (0v2/jiw).
  - App shell (resizable panels, full theming, drag feedback).
  - Remaining path ops, utils (isClockwise, Polylabel, more math), tests, final oracle side-by-side verification (f33).
- Architecture decisions (from prior work + large-frontend-rewrite reference): Pure SVG + React pointer events for canvas (faithful to paper gestures via explicit handlers), Zustand for state, shadcn/ui + Tailwind, Material Symbols, Framer Motion for polish where it enhances without jank.

**Architecture Approach:**
- Preserve soul of original (high-quality morphing via structured PathData + real algorithms, professional direct manipulation in Action Mode, rich timeline-driven animation).
- Modern 2026 stack: React 19/Next 16, TypeScript strict, Zustand + Immer for immutable updates, pure functional pathUtils.
- Canvas: Three independent panes (From / Live Preview using `getInterpolatedPath` / To) with per-pane pan/zoom.
- Timeline: Draggable/resizable blocks per layer/property, grid, interpolators, playback that drives global progress + preview.
- Data model: Single source of truth in store (layers + animation.blocks + selection + toolMode + history).
- Fidelity verification: Side-by-side manual + scripted oracle tests against original behaviors (not just visual).

**Tech Stack:** Next.js, React, TypeScript, Tailwind + shadcn/ui (Base UI), Zustand, Framer Motion (selective), Lucide + Material Symbols, Sonner toasts.

**Execution Strategy:**
- Master plan lives here + in bd (ShapeShifter-7uu children).
- Use `todo` tool in every turn for live task status.
- Parallel waves via `delegate_task` + subagent-driven-development (fresh subagent per task + 2-stage review: spec compliance then code quality).
- After every 3-5 tasks on a core file: explicit stabilization pass (`read_file` full → `write_file` clean version).
- Frequent small commits + bd updates.
- "Next concrete step" rhythm honored, but user "plan and do everything" directive authorizes aggressive parallel waves + enhancement passes.
- Do not close any bd wave until f33 verification passes (side-by-side + behavior parity tests).

**Wave Breakdown (aligned to existing bd P0 waves + gaps):**

## Wave 0: Foundations & Audit (cdx, aun, 7j0, jpn)
- Audit all original algorithms not yet ported (isClockwise, Polylabel pole finding, full math/matrix utils).
- Expand store for full clipboard, advanced timeline slices, action mode state.
- Ensure all pathUtils have full test coverage for original behaviors.
- **Files:** `lib/shapeshifter/{mathUtils, pathUtils}.ts`, `lib/store/editorStore.ts`, tests.
- **Verification:** Run full test suite; `bd close` sub-issues only after parity confirmed.

## Wave 1: Path Core & Auto-Fix Completeness (jpn, s65)
- Complete remaining path operations (full pairSubPaths from PairSubPathHelper, advanced split variants, bezier-aware clockwise + Polylabel).
- Enhance autoFix with more original scoring/alignment.
- **Files:** `lib/shapeshifter/pathUtils.ts`, tests.
- **Tasks:** TDD each new pure function.

## Wave 2: Canvas Direct Manipulation Completion (sy0 - already strong base)
- Add pen tool full curve creation (click-drag for handles).
- Pencil/ellipse freehand gestures.
- Double-click handle toggle (sharp <-> smooth, port of ToggleSegmentHandlesGesture).
- Hover states, precise cursors, box select transforms (scale/rotate on multi-selection, not just translate).
- Full hit testing (curve hits for add-point, not just points).
- **Files:** `components/editor/PathCanvas.tsx`, store toolMode slices.
- **Verification:** Manual side-by-side with original paper gestures on identical paths.

## Wave 3: LayerTimeline Full Rewrite (h5b, fiy - strong recent progress)
- Complete draggable/resizable blocks (edge resize for duration).
- Full grid with snap to frames/seconds, visual time ruler scrubbing that drives global progress + live preview.
- Per-block advanced editor (interpolator picker already started; add easing curves preview, delete, duplicate).
- Multi-block selection + batch operations (align, distribute in time).
- Playback integration: timeline drives the three canvases in real time with correct interpolation.
- **Files:** `components/editor/LayerTimeline.tsx`, store animation mutations.
- **Verification:** Recreate original demo timelines; scrubbing produces identical morphs to original.

## Wave 4: Toolbar, Toolpanel, Keyboard, Clipboard, Inspector Full Parity (iet, uak, 905)
- All remaining original toolbar actions (onContributeClick, full feedback, more split variants, etc.) with icons + toasts.
- Complete dynamic activation states (disable when no selection, Action Mode context).
- Full keyboard coverage for every original gesture/action + modern enhancements (command palette ⌘K if not present).
- Clipboard: copy/paste points, subpaths, layers, full paths (with proper serialization).
- Inspector: full property editing for groups/clip, transforms, advanced path props; multi-selection support.
- **Files:** `components/editor/{Toolbar,Inspector}.tsx`, `app/page.tsx` (keyboard), store clipboard slices.
- **Verification:** Every original toolbar button + shortcut produces identical result to Angular version.

## Wave 5: Dialogs, Modals, Splash, Demo Flows + Full Import/Export (4vt, 0v2, jiw, xjw, js2, o2i, d0d)
- Splashscreen on first load with "Getting Started", recent projects, samples.
- Confirm dialogs for destructive actions (delete layer, clear, etc.).
- Demo chooser modal (port original demos + new ones).
- Import: Full SVG parser (with <use> resolution, nested groups), Vector Drawable full fidelity, .shapeshifter project format (load/save with layers + animation + selection state), drag-drop everywhere, error recovery + toasts.
- Export: All original formats (SVG animated, Vector Drawable, .shapeshifter) + modern (Lottie full, CSS keyframes, GIF/MP4 via canvas capture, high-quality PNG sequence).
- **Files:** `components/editor/{ImportDialog,ExportDialog,Splash,ConfirmDialog}.tsx`, `lib/shapeshifter/{importers,exporters,project}.ts`, app/page.tsx drop handlers.
- **Verification:** Roundtrip identical paths + animation from original files; side-by-side export comparison.

## Wave 6: Groups, ClipPaths, Hierarchy, Transforms, App Shell Polish (127, 977, pgn, s41)
- Full layer hierarchy (parentId, nesting in rendering, inspector, timeline).
- Groups: transform container (translate/rotate/scale/skew applied to children).
- ClipPaths: proper clipping in SVG canvases + export, boolean ops if original had.
- Transforms on layers/selection with on-canvas handles (port original rotate/scale gestures via pure SVG or minimal helpers).
- App shell: resizable panels (splitters), full theming (light/dark + accent), drag feedback, responsive, command surface polish.
- **Files:** `lib/shapeshifter/types.ts` (Layer model), `components/editor/{CanvasArea,PathCanvas,LayerTimeline,Inspector}.tsx`, store layer mutations + transform slices, global CSS.
- **Verification:** Complex nested group + clip demos from original work identically (including export).

## Wave 7: Tests, Polish, Final Verification Gate (c2a, f33)
- Comprehensive test port + new tests for all ported behaviors (pathUtils TDD, store actions, canvas interactions via testing-library + jsdom or Playwright for gestures).
- Final oracle: scripted + manual side-by-side sessions with original (identical paths, same gestures, same outputs).
- Polish pass: performance (memoization, virtualized timeline if large), accessibility, error boundaries, loading states.
- Documentation: update README with "100% Parity Achieved" + migration notes.
- **Files:** All test files, `app/page.tsx`, README.md, .hermes/plans verification scripts.
- **Gate:** Only close `ShapeShifter-7uu` and f33 when two independent reviewers (or subagent + human) confirm zero behavioral differences on core flows.

**Files Likely to Change (comprehensive):**
- Core: `lib/shapeshifter/**/*` (heavy in Waves 0-1), `lib/store/editorStore.ts` (all waves).
- UI: `components/editor/{PathCanvas,LayerTimeline,Toolbar,Inspector,CanvasArea,Dialogs/*}.tsx`, `app/page.tsx`.
- New: Additional importers/exporters, transform utils, dialog components.
- Tests: New `**/*.test.ts(x)` + integration specs.

**Risks, Tradeoffs, Open Questions:**
- Paper.js gestures fidelity without paper.js: Mitigated by explicit pointer + math ports (already successful on canvas wave).
- Performance on complex nested groups + long timelines: Plan virtual scrolling + memoization early.
- Exact original animation timing/interpolators: Use original easing functions ported to JS.
- Scope creep on "extras": Enforce "faithful first, then enhance" per wave.
- bd/git hygiene on long sessions: Mandatory `bd dolt push` + `git push` after every wave.
- Context limits on massive plan: Subagents get bite-sized tasks only.

**Verification & Close Criteria:**
- Every original toolbar action, gesture, import/export path, timeline interaction, group transform produces identical visual + data result.
- `bd show ShapeShifter-f33` passes with attached evidence (screenshots, test output, side-by-side videos if possible).
- No open P0/P1 gaps in `bd ready`.
- Final commit message: "feat: 100% Angular ShapeShifter feature parity achieved".

**Post-Plan Execution Notes:**
- After this plan is saved, next turn will dispatch subagents in parallel on independent waves (e.g., one subagent per wave where possible).
- Use `todo` tool to track live status across the entire master plan.
- Honor "next concrete step" when user directs incremental, but "plan and do everything" authorizes full parallel waves + stabilization passes.

**Plan saved:** 2026-05-24. Ready for subagent-driven execution on user confirmation.

---

**Next immediate action after user "Go" on this plan:** Load `subagent-driven-development`, create live `todo` list from this plan, and begin dispatching the first 2-3 parallel tasks (e.g., Wave 3 timeline completion + Wave 6 groups skeleton + Wave 5 import SVG parser enhancement).