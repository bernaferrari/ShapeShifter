# ShapeShifter

ShapeShifter is a browser-based editor for **Android VectorDrawable** and **AnimatedVectorDrawable** assets. It is designed for building, editing, previewing, and exporting Android vector motion—not as a general-purpose Figma replacement.

Author paths directly, organize them into Android-style groups and clip paths, animate supported properties on a timeline, and export production-oriented Android resources. SVG and Lottie exports are available when an asset also needs to travel outside Android.

## What it supports

### Vector Drawable authoring

- Editable SVG path commands, anchors, Bézier handles, pen, pencil, knife, lasso, and paint tools
- Paths, groups, and clip paths with ordered Android-style clipping behavior
- Group and path transforms: translation, rotation, scale, and pivot
- Solid fills, gradients, fill rules, strokes, caps, joins, miter limits, dash arrays, and trim paths
- Accurate curve-aware bounds, hit testing, marquee selection, and direct editing under transforms
- Android root metadata: intrinsic size and units, viewport size, alpha, tint, tint mode, and auto-mirroring

### Motion

- Timeline animation for Android-compatible path, color, alpha, trim, and transform properties
- Bézier easing, including Android named interpolators and custom cubic curves
- Morph endpoint preservation and morph compatibility checks before Android export
- Playhead-aware rendering, selection, hit testing, and transform editing
- Motion paths for animated translation tracks

### Import and export

| Format | Direction | Notes |
| --- | --- | --- |
| Android VectorDrawable XML | Import / export | Preserves groups, paths, clip paths, styling, viewport, dimensions, and supported root metadata. |
| Android AnimatedVectorDrawable | Export | Produces drawable, animator, and interpolator resources in a ZIP. Invalid path morphs block export instead of silently degrading it. |
| ShapeShifter project JSON | Import / export | Lossless project backup, including morph endpoints and Android metadata. |
| SVG | Import / export | Static SVG, animated SVG, CSS keyframes, and spritesheets. |
| Lottie JSON | Export | Visible layers, parent groups, shape morph endpoints, and transform/opacity/color timeline tracks. |
| PDF | Export | Static document export. |

Android export diagnostics are surfaced before download. Treat them as part of the asset-authoring workflow: they identify unsupported properties, hidden targets, incompatible path morphs, and Android API implications.

## Quick start

Requires Node.js 20+ and pnpm 9+.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Android workflow

1. Import a VectorDrawable XML file, SVG, or ShapeShifter project.
2. Build the hierarchy with groups and clip paths; keep Android target names stable when an animation depends on them.
3. Edit paths in local coordinates and use the timeline to animate supported properties.
4. Use **Prepare for morph** when the start and end paths do not share compatible command structures.
5. Export **Vector XML** for a static drawable or **Android AVD** for a resource ZIP.
6. Resolve every blocking Android diagnostic before adding the asset to an app.

The editor keeps the drawable’s intrinsic dimensions separate from its viewport. This matters when a `24dp` drawable uses a non-`24 × 24` coordinate system.

## Export behavior and scope

ShapeShifter aims to be explicit about target constraints.

- Android VectorDrawable is the source-of-truth target; its hierarchy, transforms, clipping, styles, and supported animation tracks guide the editor behavior.
- AnimatedVectorDrawable has a narrower property set than the editor. Unsupported tracks are reported during export rather than presented as faithful Android animation.
- Custom cubic easing is emitted as Android `pathInterpolator` resources. Unknown easing falls back with a diagnostic.
- Lottie is an interoperability export, not the canonical Android target. It carries visible document structure and supported timeline data, but Android-only semantics should be verified in the destination Lottie renderer.

## Development commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Next.js development server with Turbopack. |
| `pnpm build` | Create a production build. |
| `pnpm start` | Serve the production build. |
| `pnpm typecheck` | Run TypeScript type checking. |
| `pnpm lint` | Run Oxlint. |
| `pnpm test` | Run the Vitest suite. |
| `pnpm format` | Format the repository with Oxfmt. |

Before submitting a change, run:

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
```

## Project structure

| Path | Contents |
| --- | --- |
| `app/` | Next.js application shell and editor page. |
| `components/editor/` | Canvas, timeline, inspector, layers, import, and export UI. |
| `lib/shapeshifter/` | Path geometry, Android scene evaluation, document model, animation, importers, and exporters. |
| `lib/shapeshifter/androidCompiler.ts` | Android VectorDrawable and AnimatedVectorDrawable resource compiler plus diagnostics. |
| `lib/shapeshifter/scene/` | Shared evaluated scene graph used by rendering, selection, and hit testing. |
| `lib/store/` | Zustand editor state, history, and active-artboard synchronization. |
| `plans/` | Android-first implementation plans and acceptance criteria. |

## Quality bar

Changes to geometry, animation, import, or export code should include regression coverage. In particular, preserve parity among the canvas preview, selection/hit testing, project persistence, Android resource export, and Lottie export wherever the target format supports the same behavior.
