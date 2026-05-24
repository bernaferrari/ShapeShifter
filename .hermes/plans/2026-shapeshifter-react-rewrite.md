# ShapeShifter 2026 - Modern React/Next.js Rewrite Implementation Plan

> **For Hermes:** Use subagent-driven-development skill or direct implementation task-by-task. This is a full transformation of the 2017 Angular icon animation tool into a 2026 masterpiece using Next.js 16, React 19, shadcn/ui (base-ui), Tailwind 4, Zustand, Framer Motion.

**Goal:** Deliver a production-grade, beautiful, highly usable path morphing animation editor that surpasses the original in design, UX, performance, and features while preserving and enhancing all core functionality (path editing, compatibility, auto-fix, export to SVG/CSS/AVD).

**Architecture:**

- Next.js App Router with TypeScript.
- Zustand for global canvas/layer/timeline state (with undo via middleware or custom history).
- Pure SVG + React for canvas (no paper.js dependency; custom draggable points, bezier handling).
- Ported core model: modern TS classes or immutable data for Path, SubPath, Command with methods for edit, split, morph.
- Framer Motion for smooth previews, transitions, drag.
- shadcn/ui + custom editor components for panels.
- Linear.app inspired dark theme (near-black, indigo accent, Inter/Geist) + polished light mode + toggle (already in base with 'd' hotkey).

**Tech Stack:** Next 16 + React 19, TypeScript, Tailwind 4, shadcn (base), Zustand 5, Framer Motion 12, react-resizable-panels, Sonner toasts, Lucide + Material Symbols icons.

**Key Improvements over original:**

- Resizable modern panels, collapsible sidebars.
- Real-time live morph preview always visible.
- Better point editing UX (hover previews, snap, multi-select?).
- Material Symbols variable font support + custom icon imports.
- Keyboard-first (shortcuts everywhere, command-k palette?).
- Undo/redo robust, localStorage persistence + export/import project.
- Modern exports: animated SVG, CSS, AVD, Lottie JSON, GIF via canvas.
- Demos gallery with one-click load.
- Accessibility, performance (memo, virtual?), beautiful motion.
- PWA ready.

**Verification:** `pnpm dev`, browser test interactions, export roundtrips, compare morph quality with original where possible.

---

## Phase 0: Project Setup & Design System (Completed in init)

- [x] Initialized with shadcn preset b2YQpk + base + next + pointer + name.
- [x] Moved to root, preserved .git and .original-angular backup.
- [x] Added: zustand, framer-motion, sonner, react-resizable-panels.
- [x] Added shadcn components: input, slider, select, dialog, tabs, dropdown, tooltip, popover, card, badge, separator, resizable, textarea, switch.
- ThemeProvider with next-themes + 'd' hotkey + system already present.

**Next immediate:** Customize theme to Linear-inspired (indigo accent, near-black surfaces), add Material Symbols, providers, Toaster.

---

## Phase 1: Design System Polish & Icons (High Priority)

### Task 1.1: Enhance Theme & globals.css for Linear 2026 Aesthetic

**Objective:** Make dark mode the star (Linear #08090a, #0f1011, indigo #5e6ad2 accent), light mode clean and usable. Use Geist already present. Add editor-specific tokens for canvas bg, point colors, path strokes.

**Files:**

- Modify: app/globals.css (add custom @theme, .editor-canvas styles, Material Symbols integration)
- Modify: app/layout.tsx (add font link or style for Material Symbols, wrap TooltipProvider + Toaster)

**Step 1:** Update CSS variables in :root and .dark to Linear palette (near black bg, subtle borders rgba white 0.05-0.08, indigo for --primary, --accent).

Include OKLCH or hex for indigo: primary #5e6ad2 / violet #7170ff.

Add:

```css
--editor-canvas-bg: ...;
--path-stroke: ...;
--point-fill: #7170ff;
```

Add styles for .path-editor svg { ... }, .control-point { transition, hover scale }, ruler, etc.

**Step 2:** Add Material Symbols:
In layout head or body:

<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />

CSS:
.material-symbols {
font-family: 'Material Symbols Outlined';
font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}
For filled: 'FILL' 1.

Support size via class or style.

**Step 3:** Add Toaster and providers in layout.

**Verification:** Run dev, toggle 'd', inspect colors, see icon font load. Screenshot with browser tool if available.

### Task 1.2: Icon System & Toolbar Foundation

**Objective:** Create Icon component that prefers Material Symbols, falls back to Lucide, allows custom SVG.

**Files:** Create components/icons/MaterialSymbol.tsx or unified Icon.tsx

Support: <Icon name="play_arrow" symbol /> or lucide name.

---

## Phase 2: Core Domain Model Port (Critical - Path Logic)

Port from original without paper dependency.

### Task 2.1: Define Modern Path Types & Parser

**Objective:** TypeScript types/interfaces for SvgCommand, SubPath, PathData. Parser from SVG 'd' string to structured commands.

**Files:**

- Create: lib/shapeshifter/types.ts (CommandType, Point, Command, SubPath, PathLayer)
- Create: lib/shapeshifter/pathParser.ts (parsePath, commandsToString, normalize)

Support M, L, H, V, C, S, Q, T, A, Z. Store as objects with id (for React keys), type, points[], etc.

**Step 1:** Write parser using regex or tokenizer for 'd' attr.

**Step 2:** Tests? Use vitest or just manual in dev.

### Task 2.2: Path Class / Utils - Edit Operations

**Objective:** Port key methods: addPoint, deletePoint, reverse, shift, split, makeCompatible, autoFix.

**Files:** lib/shapeshifter/Path.ts or hooks/usePath.ts + pure functions.

Include calculators for bezier point projection (from BezierCalculator etc).

Implement NeedlemanWunsch + AutoAwesome logic for auto fix (align two paths' command sequences for morphing).

This is the heart - ensure morphs work by making command count/types match.

### Task 2.3: Morphing / Interpolation Engine

**Objective:** Function to interpolate between two compatible Path states at t (0-1), producing intermediate 'd' string for animation.

Use for preview playback and export.

Support easing.

---

## Phase 3: State Management & Canvas Editor

### Task 3.1: Zustand Store for Editor

**Objective:** Create store/editorStore.ts with:

- layers: Layer[] (id, name, from: PathData, to: PathData, visible, locked)

- selectedLayerId, editingSide: 'from' | 'to'

- playback: { playing, progress, speed, loop }

- history for undo (array of snapshots + pointer)

- ui: zoom, pan, snapToGrid, showPoints, showRulers

Actions: addLayer, updatePath, selectPoint, movePoint, addPointAt, deleteSelected, reversePoints, shiftPoints, autoFixLayer, play/pause, setProgress, importSVG, etc.

Use persist middleware for localStorage.

### Task 3.2: SVG Canvas Component - The Masterpiece Editor

**Objective:** <PathCanvas> component that renders one or side-by-side paths, interactive points.

Features:

- SVG with viewBox dynamic for zoom/pan (use state or wheel handlers).
- Render <path> for from/to with stroke, fill none.
- For each command point (end points of segments), render draggable <circle> + optional bezier handles (for C/Q).
- Click path to insert point (project to nearest using bezier math).
- Drag with pointer events + framer drag or raw, with snap.
- Multi layer? But focus per editing side.
- Visual: dashed for to, solid for from, ghost for preview.
- Rulers, grid optional.
- Selection: click point highlights, property sync.
- Keyboard: arrows nudge, delete, esc deselect.

Use React.memo, useCallback heavy.

Beautiful: subtle shadows on points, hover ring in accent color, smooth drag with spring?

**Files:** components/editor/Canvas.tsx , PathRenderer.tsx , ControlPoint.tsx

### Task 3.3: Layer Timeline & List Panel

Use resizable panels.

- Left or bottom: Layers list (shadcn cards or table like, with visibility eye, lock, rename inline with input).
- Timeline: horizontal scrubber with playhead, layer rows showing from/to mini previews or key indicators.
- Add/remove layer buttons, duplicate.

Framer for scrubber drag.

---

## Phase 4: Panels, Toolbar, Playback, Properties

### Task 4.1: Top Toolbar

Modern shadcn buttons + dropdowns.

- File: New, Open (import JSON or SVG), Save (export project JSON), Export menu (SVG anim, CSS, AVD, Lottie, GIF).
- Edit: Undo, Redo, (use history), Select all points, etc.
- View: Zoom in/out/reset, Toggle grid, rulers, points, dark/light (or rely on global).
- Animation: Play/Pause, Speed select (0.5x - 4x), Loop toggle.
- Help: Shortcuts dialog, About (credit original author).

Use Material Symbols or Lucide for icons (play, pause, undo, download, layers, etc).

### Task 4.2: Property Inspector (Right Panel)

When point selected: shadcn inputs for x,y ; type select (if convertible); numeric for arc params if A.

Buttons: Delete point, Split subpath?, Reverse subpath.

Use controlled inputs, live update store.

Also global layer props: name, duration per layer?

### Task 4.3: Playback Bar (bottom or integrated)

Scrubber (input type range or custom div with drag), time display, speed, play controls, progress %.

Sync with canvas preview using framer or SVG animateMotion or JS raf loop that updates a 'previewPath' state.

---

## Phase 5: Import/Export & Advanced Features

### Task 5.1: SVG Import & Path Extraction

Drop target or paste, use DOMParser or regex to find <path d= >, load into layers.

Support multi-path SVGs as multi layers or compound.

SVGO optional for optimize? Later.

### Task 5.2: Export Implementations

- Animated SVG: <svg> with <path> + <animate attributeName="d" ... values="from; to" > or multiple frames.
- CSS @keyframes with clip or path morph (use clip-path or SMIL, or JS).
- Android AVD XML generator (port logic).
- Lottie: simple JSON structure for path morph (using shape layers).
- GIF: use modern-canvas-to-gif or html-to-canvas + gif.js (add dep if needed).

### Task 5.3: Demos Gallery & Samples

Modal or sidebar tab with cards of famous morphs (play-pause, arrow, etc) from original art/.

Click loads into editor.

Hardcode sample path data.

### Task 5.4: Undo/Redo & Persistence

Zustand with subscribe or custom, limit 50 history.

Auto save to local every change, load on mount with toast "Restored session".

---

## Phase 6: Polish, Shortcuts, Accessibility, Performance

### Task 6.1: Keyboard Shortcuts System

Global listener (ignore in inputs), map:

- Space: play/pause
- Cmd/Ctrl+Z : undo
- Delete/Back: delete selected
- A: auto fix
- R: reverse
- S: shift
- G: toggle grid
- +/- : zoom
- Cmd+K : open command palette (simple dialog with actions)

Show cheatsheet in help.

### Task 6.2: Motion & Delight

- Framer for panel open/close, point pop, path morph transitions.
- Subtle: point drag spring, preview fade.
- Respect prefers-reduced-motion.

### Task 6.3: QA & Edge Cases

- Incompatible paths handled gracefully (warn + auto fix suggestion).
- Large paths performance (simplify?).
- Touch support for tablets?
- Export fidelity tests.

**Test commands:** pnpm dev ; pnpm build ; manual browser interactions.

---

## Execution Notes

- Prefer pure functions + hooks over classes for React friendliness.
- Make Path logic testable (extract to lib/).
- Start with minimal viable (1 layer, M/L/C support, basic drag/add/delete, live preview, exports) then layer features.
- After core, use browser_vision or manual to verify beauty.
- If needed, delegate canvas or export sub tasks to subagents with full context.

**Success Metric:** A delightful tool that makes users say "wow, this is so much better than the old one" - fast, gorgeous, powerful, fun to use.

Start with Phase 1 tasks immediately after this plan.
