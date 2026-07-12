# ShapeShifter

ShapeShifter is a browser-based vector animation editor built with React and Next.js. Edit SVG paths, create shape morphs, preview motion, and export animations for the web and Android.

## Features

- SVG canvas with selection, path editing, zooming, panning, and shape tools
- Layer tree and timeline for organizing and animating vector layers
- Path morphing utilities, including auto-fix, reverse, and shift operations
- SVG, Android VectorDrawable XML, and ShapeShifter project imports
- SVG, animated SVG, CSS keyframes, Lottie, Android VectorDrawable/AVD, PDF, spritesheet, and project JSON exports
- Light and dark themes, keyboard shortcuts, drag-and-drop import, and a command palette

## Getting started

Requires Node.js 20+ and pnpm 9+.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the development server with Turbopack. |
| `pnpm build` | Create a production build. |
| `pnpm start` | Serve the production build. |
| `pnpm typecheck` | Run TypeScript type checking. |
| `pnpm lint` | Run Oxlint. |
| `pnpm test` | Run the Vitest suite. |
| `pnpm format` | Format the repository with Oxfmt. |

## Project structure

| Path | Contents |
| --- | --- |
| `app/` | Next.js application shell and editor page. |
| `components/editor/` | Canvas, toolbar, inspector, layers, and timeline UI. |
| `components/ui/` | Reusable UI primitives. |
| `lib/shapeshifter/` | Animation model, geometry, import/export, SVG rendering, and gesture logic. |
| `lib/store/` | Zustand editor state and history. |

## CI

GitHub Actions runs the following checks for pull requests and pushes to `master`:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Run the same commands locally before opening a pull request.

## Technology

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Zustand, shadcn/ui, Vitest, and pnpm.
