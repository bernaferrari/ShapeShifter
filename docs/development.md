# Run Pathshift locally

Pathshift uses Node.js 24.x and pnpm 11.22.0. The application and internal modules use the Pathshift name; the GitHub repository retains its original URL.

## Start the editor

```bash
git clone https://github.com/bernaferrari/ShapeShifter.git
cd ShapeShifter
pnpm install --frozen-lockfile
pnpm dev
```

Open [localhost:3000](http://localhost:3000). If that port is occupied, use `pnpm dev --port 3001` and open the corresponding address. No account or API key is required for local editing.

For a production build:

```bash
pnpm build
pnpm start
```

Set `NEXT_PUBLIC_SITE_URL` to the public origin (for example, `https://your-domain.example`) when deploying. Vercel's production URL is detected automatically. This resolves the canonical link and Open Graph/Twitter share-image URLs. The generated share card lives in `app/opengraph-image.tsx`; `app/icon.svg`, `app/favicon.ico`, and `app/apple-icon.tsx` supply the browser and iPhone icons.

## Working on the project

The app uses **Next.js 16, React 19, TypeScript, Tailwind CSS 4, and Zustand**. Vitest covers behavior; Oxlint and Oxfmt handle linting and formatting. Paper.js supplies the curve Boolean kernel.

| Command          | Purpose                                      |
| ---------------- | -------------------------------------------- |
| `pnpm dev`       | Start the development server with Turbopack. |
| `pnpm build`     | Build for production.                        |
| `pnpm start`     | Serve the production build.                  |
| `pnpm typecheck` | Check TypeScript types.                      |
| `pnpm lint`      | Run Oxlint.                                  |
| `pnpm test`      | Run the Vitest suite.                        |
| `pnpm format`    | Format the repository with Oxfmt.            |

Before submitting a change, run the same checks as [CI](../.github/workflows/ci.yml):

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

On machines with limited memory, run `pnpm test --maxWorkers=4`. To focus on a regression, pass its test-file path to `pnpm test`.

### Code map

| Path                                                                            | Responsibility                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`app/`](../app/)                                                               | Application shell, editor page, and global styles.                            |
| [`components/editor/`](../components/editor/)                                   | Canvas, layers, inspector, timeline, dialogs, and keyboard interaction.       |
| [`lib/pathshift/path/`](../lib/pathshift/path/)                           | Geometry, direct editing, validation, trim evaluation, and Boolean worker.    |
| [`lib/pathshift/scene/`](../lib/pathshift/scene/)                         | Evaluated scene shared by rendering, selection, bounds, and hit testing.      |
| [`lib/pathshift/motion/`](../lib/pathshift/motion/)                       | Timeline authoring, keyframes, preview ranges, and motion graph calculations. |
| [`lib/pathshift/androidCompiler.ts`](../lib/pathshift/androidCompiler.ts) | Native Android resource compilation and diagnostics.                          |
| [`lib/pathshift/export/`](../lib/pathshift/export/)                       | Project, Lottie, and PDF exporters.                                           |
| [`lib/store/`](../lib/store/)                                                   | Editor state, document transactions, history, and local recovery.             |
| [`lib/agent/`](../lib/agent/)                                                   | Validated agent commands and WebMCP registration.                             |
| [`plans/`](../plans/)                                                           | Implementation plans, acceptance criteria, and review evidence.               |

### Contributing

Keep the canvas, selection, hit testing, persistence, and exports consistent for the same document. Geometry and animation changes should include regression coverage for the behavior they affect. Test cancellation and Undo as well as the successful edit; document target-specific approximations instead of silently discarding unsupported data.

The [editor quality review](../plans/editor-quality-review.md) records production-browser acceptance checks, regression results, screenshots, and remaining limits. Include a reproducible asset or project file when reporting an import, morph, or export issue.

## Browser workflows

```bash
pnpm build
pnpm test:browser
```

The browser suite covers drawing, grouping, animation, duplication, undo, save/reload, downloads, morph previews, and the guided exercise on desktop Chromium and phone WebKit.

[Back to Pathshift](../README.md)
