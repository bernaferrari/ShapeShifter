# ShapeShifter editor quality review

Reviewed and refined on October 4, 2026. Figma is the user's 10/10 reference for interaction quality. The existing product targets Android VectorDrawable and AnimatedVectorDrawable, with SVG, Lottie, PDF, and project interchange.

The original review identified incomplete selection transforms, direct editing, motion authoring, recovery, export trust, and agent access. This implementation addresses those gaps. Quality is a judgment about usable workflows, not a consequence of a test count. Final acceptance results follow below.

## Vector editing

| Workflow         | Refined behavior                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection        | Evaluated group bounds and complete parent matrices shared by display, hit testing, and selection.                                                                                        |
| Transforms       | Nested move, resize, and rotation use inverse parent transforms. Editing at the playhead records linked segments; gestures cancel and Undo atomically.                                    |
| Locks            | Descendants inherit ancestor locks in the canvas, direct editor, and agent interface.                                                                                                     |
| Anchors          | Shift multi-selection and movement under full transforms, using frozen geometry and atomic cancellation.                                                                                  |
| New geometry     | Independent Pen paths, dragged Bézier handles, path closure/finish, Rectangle and Ellipse with grid/equal-side/center modifiers.                                                          |
| Boolean geometry | Curve intersection tracing for Union, Subtract, Intersect, and Exclude, preserving fractional precision, transformed operands, and holes. The back path supplies the result's appearance. |
| Layers           | Keyboard tree navigation, rename cancellation, nested button activation, empty-group drop targets, and appearance-preserving static reparenting.                                          |
| Inputs           | Fractional drafts commit on Enter/blur. Escape cancels; empty or invalid values leave the document intact.                                                                                |
| Interruption     | Pending gestures block competing agent writes. Undo, cancellation, owner changes, secondary pointers, and unmount cannot revive stale geometry.                                           |

World geometry tools pause playback, return to the base pose, and edit From geometry. Scrubbing or playback returns to Move. Explicit morph editing retains its selected endpoint context.

Raw SVG path text remains a draft until blur or Cmd/Ctrl+Enter. Incomplete commands show an inline error; Escape cancels and one Undo restores a valid replacement. Base path edits synchronize the first/last explicit path keyframes, including agent commands, so geometry authoring, time-zero preview, persistence, and export stay connected.

## Motion editing

- Precise numeric, color, and path endpoint editors with linked segment boundaries.
- Fresh morph authoring creates an explicit pathData track, including its Android animator export.
- Property creation includes translation, scale, rotation, pivots, opacity, fill/stroke colors and opacity, stroke width, trim paths, and geometry. Group and clip-path choices reflect their supported property sets.
- Android trim tracks now export as native float animators, matching the [official Android path attribute support](https://developer.android.com/reference/android/graphics/drawable/AnimatedVectorDrawable).
- Preview trims slice geometry before fill and stroke, following [Android's native implementation](https://android.googlesource.com/platform/frameworks/base/+/7fd1cbd49d0ace00c65229f65252136902aedaf3/libs/hwui/VectorDrawable.cpp). Empty, wrapped, offset, and multiple-contour cases share the same geometry with hit testing and static SVG/PDF. Explicit morph endpoint editing retains its selected pose.
- Keyframe insertion splits tracks at the exact playhead; canvas transform recording preserves fractional times.
- Timeline zoom/pan, focused-fit controls, 24/30/60 fps display and snapping, frame/keyframe navigation, and precise time entry.
- Compatible segment copy/paste preserves relative offsets, rejects overlap atomically, extends duration when needed, and remains one Undo transaction.
- A selected preview range loops without changing authored clip times and clears on owner change.
- Custom easing supports pointer, keyboard, and numeric X1/Y1/X2/Y2 controls. Numeric values preserve overshoot.
- Numeric segments expose value and velocity graphs from the shared easing calculation. Axes show property units and milliseconds, velocity uses seconds, and sampled ranges include overshoot. Graphs compute only when expanded or authored values change.
- Paused playback stops scheduling frames. Timeline writes preserve unrelated layer identities; scene construction reuses parsed paths and indexed tracks.
- Undo/Redo restores motion selection and endpoint-editing context. Global shortcuts respect focused controls, composition, and dialogs.

## Recovery and export

Autosave exposes restoring, saving, saved, error, paused, and conflict states. Pending edits are captured on visibility/page lifecycle changes. IndexedDB compare-and-swap transactions protect another tab's newer save.

File → Earlier autosaves exposes the latest local copy and up to 20 retained checkpoints. Restore is one Undo operation, preserves the displaced disk copy, and reports persistence failure. Backups remain downloadable, including malformed snapshots. Imported geometry and Android metadata enter history together. Derived timeline path IDs remain stable across persistence round trips.

Export preflight displays diagnostics before download. Invalid Android morphs block export. Static formats explicitly use base artwork; motion formats include the timeline. Only settings used by the selected format appear.

PDF fixes cover graphics-state separation, clipping, transparency, trim paths, fill rules, stroke caps/joins/miter limits, and dash arrays. Independent PDF readers rendered fixtures. Lottie fixes cover scale units, drawing order, pivots, inherited opacity, gradient fallback, path normalization, timeline holds, sampled keys, and vector/color encoding. The official Lottie renderer rendered transformed, colored, and morphed fixtures. Unsupported target semantics produce diagnostics.

## Agent editing

Seven native WebMCP tools expose inspection, scene evaluation, atomic edits, selection, Undo, Redo, and export. File → Agent tools exposes the same local interface when WebMCP is unavailable. See [the agent guide](../docs/agent-editor.md).

Commands require explicit owner-qualified IDs and an expected revision. Complete batches validate before writing and remain one Undo step. Invalid, missing, locked, stale, or unsupported targets reject safely. Playback/live gestures block competing edits. Inspection returns detached data; export preserves selection, playhead, history, and revision.

The allowlist covers rename, property updates, path replacement/creation, and timeline block creation/removal. It does not expose raw state mutation, arbitrary code execution, or a dry-run command.

## Interface polish

Semantic surfaces now match across light/dark rulers, timeline, clips, easing controls, and inspector. Larger drawing targets, navigation above the canvas, correctly constrained resizable panels, and unmounted collapsed controls improve use and focus order. Visible command search, accessible labels, keyboard frame activation, save feedback, and truthful export copy support repeated daily use.

The revised primary blue reaches approximately 4.7:1 contrast against its near-white foreground using linear sRGB luminance, improving small filled-control labels.

## Deliberate limits

- Figma's typography, components, constraints, libraries, and multiplayer breadth remain outside this Android vector editor's scope. Workflow quality does not imply parity with that breadth.
- Multi-owner resize/rotate is unavailable. Mixed rotations resize proportionally to avoid unrepresentable shear.
- Boolean operations require static, closed, visibly filled paths in one owner. Animated, masked, locked, and open paths are refused with an explanation; stroke outline conversion remains future work.
- Transfers through animated ancestors, ordered masks, or unsupported transformed destination groups are refused when appearance cannot be preserved. Supported static transfers preserve transforms, opacity, and clipping with wrappers.
- Accelerate–decelerate keyframe insertion preserves the sampled pose but retimes the transition; a cosine cannot be split exactly into one cubic per segment. Color/path values have target-specific clamping/quantization.
- Authoring frame rate controls display/snapping, not destination renderer frame rate.
- Velocity graphs show a sampled numerical derivative for one numeric segment. Color and path segments do not expose numeric velocity. Trim preserves Bézier subdivisions; length inversion is numerical, and arcs use the editor's cubic normalization.
- Autosave is browser-local. Termination can interrupt asynchronous writes; quota failures retain the open document and offer retry/backup. Cloud sync and a multi-document library remain future work.
- Representative 100/500-path documents with three tracks per path improved median scene evaluation from about 5.7/48 ms to 0.87/12.7 ms in the measured local run. These are engine measurements, not a certified browser pointer/playback budget; concurrent CPU load made tail measurements noisy.

## Final acceptance

The final acceptance pass used an optimized production build and real browser controls.

- Full regression suite: 94 files and 1,378 tests passed with four workers.
- TypeScript, lint, changed-file formatting, and diff checks passed.
- The final production build succeeded. The last graph accessibility copy refinement passed all 11 graph component tests and another production build.
- The final production browser emitted no console errors or warnings. Native AVD export was ready with no blocking diagnostics; custom rotation evaluated to 18.314° against its 15° endpoint, confirming overshoot.
- Typed and agent path replacement both synchronized the initial path keyframe and evaluated geometry. Native Vector/AVD export was ready. Sequential Undo restored the entire original document exactly.
- Trim start/middle/end evaluations returned empty/partial/full geometry. A static filled-and-stroked trim exported to SVG and PDF; Poppler parsed and rendered the PDF, preserving implicit fill closure and an open stroke.
- The saved demonstration document survived the final build refresh exactly, with seven native WebMCP tools available. The preview remains open at http://localhost:3002.

Vitest emits React `act` warnings in some gesture harnesses and expected diagnostics for malformed input fixtures; every test passes. These warnings did not occur in the production browser.

The production-browser pass exercised actual controls and native WebMCP calls:

| Workflow            | Evidence                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Drawing             | Rectangle and Ellipse pointer gestures; a new Pen path with dragged handles, closure, and direct anchor movement.                                                        |
| Boolean curves      | Browser-worker Union of overlapping ellipses; one Undo restored both operands and Redo restored the result.                                                              |
| Precise motion      | Linked keyframe insertion, fractional custom easing controls, copied segments, frame display, and evaluated overshoot.                                                   |
| Preview range       | Playback stayed inside the selected range; a competing agent write rejected with EDITOR_BUSY.                                                                            |
| Export trust        | A deliberately incompatible morph blocked AVD download; Undo restored a ready native export. PDF parsed with an independent reader; Lottie reported its trim limitation. |
| Recovery            | Keyboard checkpoint selection, restore, Undo, save, and reload retained the exact document and stable IDs.                                                               |
| Agent transactions  | A validated batch changed multiple properties atomically; a stale revision rejected; one Undo restored the batch.                                                        |
| Keyboard and layout | Layer rename cancellation, tree navigation, frame Space activation, and an 820 × 740 layout with reachable drawing tools and panel controls.                             |

Editor screenshot: [canvas, timeline, and easing controls](../artifacts/editor-review/editor.jpg). Independent filled-trim PDF proof: [document](../artifacts/export-fixtures/production-trim.pdf) and [render](../artifacts/export-fixtures/production-trim.png).

Assessment: approximately **9/10 for the supported Android vector and motion workflows**, judged on drawing precision, coherent editing, motion authoring, recovery, export trust, and repeated browser use. Figma remains the 10/10 craft reference; its broader product scope is described in the deliberate limits above.

Next.js generated the standard AGENTS.md and CLAUDE.md guidance; these files are separate from editor functionality.

## Timeline comparison refinement — October 4, 2026

Compared the timeline in the local Glyphrise 3D editor with ShapeShifter's motion workflow. The useful references were `TimelineSnapping.ts`, `TimelineKeyframeModel.ts`, `useTimelineTrackKeyframes.ts`, and `TimelineKeyframeEditor.tsx` under that project's `components/editor/timeline/` directory.

| Idea adapted                  | ShapeShifter behavior                                                                                                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Magnetic snapping             | Segment rails, endpoint diamonds, and ruler scrubbing snap to nearby keyframes, the playhead, and bounds. An eight-pixel threshold stays consistent across zoom levels; fractional targets stay exact. The guide names its target, and Alt/Option bypasses snapping. |
| Related timing moves together | Selected segments use one constrained offset and one atomic history transaction. Linked neighbors retain shared endpoints. Timeline bounds, minimum segment length, unrelated segments, and inherited locks constrain the edit.                                      |
| Edit beside the keyframe      | Double-click, right-click, or Enter opens an anchored time/value editor. Inputs share the inspector's validation, focus the time field on opening, and discard drafts on Escape. Delete is deliberate; double-click no longer deletes a keyframe.                    |

These ideas were adapted to ShapeShifter's millisecond-based Android segment model. Group retiming is a pure model operation, shared by pointer and keyboard editing. Pointer sessions own their live-edit marker and history entry, so cancellation, lost capture, unmount, Undo, owner changes, and competing agent edits cannot revive a stale drag. Existing graphs, zoom, looping, and playback following already cover those reference workflows.

Validation: 98 test files and **1,412 tests passed**; TypeScript, lint, and the production build passed. Regression coverage includes fractional snapping, zoom-invariant thresholds, linked groups, collisions, inherited locks, one-step Undo, pointer interruption, invalid drafts, numeric/color/path values, keyboard opening, and explicit keyframe deletion.

Real browser controls confirmed fractional time entry at 17.25 ms, keyboard focus and Escape cancellation, and a two-property drag snapping exactly to the 777.25 ms playhead while preserving segment spacing. Production preview: http://localhost:3004. [Editor screenshot](../artifacts/editor-review/editor.jpg).

## Playback and selection refinement — October 4, 2026

Back-and-forth preview reverses at both endpoints without jumping, respects selected preview ranges and speed, preserves direction across pause/resume, and completes one return trip when looping is disabled. The setting is available in Timeline options, View, and the document inspector. Preview settings leave authored and exported motion unchanged.

Layer names and tracks now share one native scroll viewport. Names stay fixed during horizontal zoom and pan; both columns scroll vertically together. Endpoint hit areas no longer create an unnecessary horizontal scrollbar in fit view. Removed the redundant animation diamond from the Layers sidebar, replaced “bypass” with a single-line explanation of Alt/Option snapping, and made all four selection corner handles white within their blue outlines.

Validation: **1,402 tests across 98 files passed**, along with TypeScript, lint, and the production build. Browser controls verified a return from 950 ms to zero, scrolling over both timeline columns, fixed names during horizontal scrolling, and white handles over a black rectangle. Visual proofs: [selection handles](../artifacts/editor-review/selection-handles.jpg) and [playback options](../artifacts/editor-review/playback-options.jpg).
