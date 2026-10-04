# Supported features and limitations

ShapeShifter’s canonical targets are Android VectorDrawable and AnimatedVectorDrawable. Preview, editing, persistence, and native export share that document model. Other export targets report their own fidelity constraints.

## Android VectorDrawable

| Feature                                                | Import               | Preview                                 | Export                                                        |
| ------------------------------------------------------ | -------------------- | --------------------------------------- | ------------------------------------------------------------- |
| Paths, groups, ordered clip paths                      | Yes                  | Yes                                     | Yes                                                           |
| Viewport and intrinsic dimensions/units                | Yes                  | Yes                                     | Yes                                                           |
| Solid fill/stroke, fill rules, stroke caps/joins/miter | Yes                  | Yes                                     | Yes                                                           |
| Trim start/end/offset                                  | Yes                  | Yes, including empty and wrapped ranges | Yes, native attributes                                        |
| Linear/radial `aapt` gradients                         | Yes                  | Yes                                     | Yes, in viewport space                                        |
| Tint, tint mode, auto-mirroring                        | Yes                  | Retained as root metadata               | Yes                                                           |
| Hidden layers                                          | Retained in projects | Hidden                                  | Omitted with a diagnostic                                     |
| SVG dash arrays                                        | Yes                  | Yes                                     | Not native VectorDrawable styling; inspect export diagnostics |

Static Vector XML exports base artwork, not the playhead pose. Intrinsic dimensions remain separate from viewport coordinates.

## AnimatedVectorDrawable

| Feature                                                               | Preview                                 | Export                                 |
| --------------------------------------------------------------------- | --------------------------------------- | -------------------------------------- |
| Path morphs, colors, supported alpha/stroke/trim/transform properties | Yes                                     | Native animator targets                |
| Named Android interpolators                                           | Yes                                     | Named platform resources               |
| Custom cubic Bézier easing                                            | Yes, including numeric overshoot        | `pathInterpolator` resources           |
| Incompatible path morphs                                              | Held at the start geometry              | Blocked with `INCOMPATIBLE_PATH_MORPH` |
| Property unsupported by the target layer or format                    | Authoring depends on layer capabilities | Diagnostic rather than silent loss     |

AVD exports bundle drawable, animator, and interpolator resources in a ZIP. Import accepts uncompressed ShapeShifter AVD ZIPs or related drawable/animated-vector/animator XML files selected together. Compressed third-party ZIPs are outside the importer’s supported archive format.

Morph endpoints need matching command types and counts. Use **Prepare for morph** to align their structure. A successful compatibility check does not replace visual review of the transition.

## Vector editing

Pen, Rectangle, Ellipse, direct anchor/handle editing, validated raw path editing, nested transforms, grouping, and layer organization are available. Ancestor locks apply to descendants.

Union, Subtract, Intersect, and Exclude use a curve-capable worker kernel. Operands must be static, closed, visibly filled paths within one owner. Animated, masked, locked, open, trimmed, and stroke-only operands are rejected. The back operand supplies the result’s appearance; Subtract removes the front operand from the back operand.

Supported static reparenting preserves appearance. Transfers involving animated ancestors, ordered masks, or unrepresentable destination transforms are refused. Resize and rotation across multiple owners are unavailable; mixed-rotation selections resize proportionally to avoid shear.

## Motion editing

The timeline supports numeric, color, and path endpoint authoring, linked keyframe insertion, custom cubic easing, compatible segment copy/paste, and a loopable preview range. Display and snapping can use 24, 30, or 60 fps; destination playback remains controlled by its renderer.

Double-click, right-click, or press Enter on a keyframe diamond to edit its exact time and value in a popover. Fractional drafts validate before committing; Escape cancels. Deletion is explicit and linked endpoints remain coherent.

Magnetic snapping targets nearby keyframes, the playhead, and timeline bounds within an eight-pixel threshold at every zoom level. A visible guide identifies the target; Alt/Option bypasses snapping. Selected segments move with one shared offset and one Undo step. Linked neighbors follow their shared endpoint, unrelated segments prevent overlap, and inherited layer locks block edits. Escape, lost pointer capture, and unmount cancel an owned drag safely.

Value and velocity graphs show one numeric segment. Velocity is a sampled numerical derivative in property units per second; color and path segments have no numeric velocity graph. Inserting a keyframe into accelerate–decelerate easing preserves the current pose but changes transition timing.

## Interoperability exports

These targets remain experimental. Read the export dialog’s diagnostics before using the output.

| Format                          | Supported behavior                                                                          | Limits                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Static SVG                      | Base artwork, groups, paint, clipping, and static trim geometry                             | Target-specific root semantics may require diagnostics.                                                                       |
| Animated SVG                    | Selected path’s sampled From → To morph                                                     | Embedded frame-swap script; no full timeline, other property tracks, or per-track custom easing.                              |
| CSS keyframes / SVG spritesheet | Selected path’s From → To morph                                                             | No full artwork timeline.                                                                                                     |
| Lottie JSON                     | Visible hierarchy, supported path morphs, transforms, opacity, color, and easing            | Trim tracks are not emitted; unsupported clipping or paint semantics produce diagnostics. Verify in the destination renderer. |
| PDF                             | Base artwork, fill rules, clipping, transparency, trim, stroke caps/joins/miter, and dashes | Gradients and nonuniform transformed strokes may be approximated with diagnostics. No animation.                              |

Static SVG and PDF apply the same trim geometry used by the preview. Native Android and editable project exports retain the authored path and trim properties.

## Persistence and agent access

Autosave and up to 20 retained checkpoints are browser-local. Save failures expose retry and backup actions; conflicting writes from another tab are detected. **File → Version history** restores a checkpoint as one Undo step. Export project JSON for a portable backup.

Seven WebMCP tools are registered where browser support is available. **File → Agent tools** provides inspection and atomic batch editing otherwise. Agent writes use explicit IDs and expected revisions; locked targets, stale revisions, playback, and active gestures reject competing edits. See [the agent guide](agent-editor.md).

Cloud sync, multiplayer editing, a document library, typography, reusable components, and layout constraints are outside the current scope. See [the quality review](../plans/editor-quality-review.md) for acceptance evidence and more detailed limits.
