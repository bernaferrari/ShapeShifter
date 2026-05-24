# Original Port Batch 1

Scope: the first 50 sorted files under `src/app/modules/editor` in the original implementation.

## Batch Files

1. `components/canvas/CanvasLayoutMixin.ts` -> `components/editor/CanvasArea.tsx`, `components/editor/PathCanvas.tsx`
2. `components/canvas/CanvasUtil.ts` -> `lib/shapeshifter/pathUtils.ts`, canvas viewport helpers
3. `components/canvas/PairSubPathHelper.ts` -> path action-mode helpers
4. `components/canvas/SegmentSplitter.ts` -> path action-mode helpers
5. `components/canvas/SelectionHelper.ts` -> `PathCanvas` selection logic
6. `components/canvas/ShapeSplitter.ts` -> path action-mode helpers
7. `components/canvas/_canvas-theme.scss` -> Tailwind/Shadcn tokens in canvas components
8. `components/canvas/canvas.component.html` -> `CanvasArea`, `PathCanvas`
9. `components/canvas/canvas.component.scss` -> Tailwind canvas classes
10. `components/canvas/canvas.component.ts` -> React canvas controller/store integration
11. `components/canvas/canvascontainer.directive.ts` -> responsive canvas layout
12. `components/canvas/canvaslayers.directive.ts` -> rendered SVG layer stack
13. `components/canvas/canvasoverlay.directive.ts` -> selection/control overlay
14. `components/canvas/canvaspaper.directive.ts` -> direct path editing interactions
15. `components/canvas/canvasruler.directive.ts` -> canvas grid/ruler overlay
16. `components/canvas/index.ts` -> local exports not needed
17. `components/dialogs/_dialog-theme.scss` -> Shadcn dialog tokens
18. `components/dialogs/confirmdialog.component.scss` -> Shadcn confirm dialog
19. `components/dialogs/confirmdialog.component.ts` -> confirm actions before destructive changes
20. `components/dialogs/demodialog.component.scss` -> Shadcn demo dialog
21. `components/dialogs/demodialog.component.ts` -> original demo loader
22. `components/dialogs/dialog.service.ts` -> local dialog state/hooks
23. `components/dialogs/dropfilesdialog.component.scss` -> drag-drop overlay
24. `components/dialogs/dropfilesdialog.component.ts` -> import drop validation
25. `components/dialogs/index.ts` -> local exports not needed
26. `components/layertimeline/_layerlisttree-theme.scss` -> Tailwind layer tree classes
27. `components/layertimeline/_layertimeline-theme.scss` -> Tailwind timeline layout
28. `components/layertimeline/_timelineanimationrow-theme.scss` -> Tailwind animation rows
29. `components/layertimeline/constants.ts` -> timeline dimensions/helpers
30. `components/layertimeline/index.ts` -> local exports not needed
31. `components/layertimeline/layerlisttree.component.html` -> `LayerTimeline` tree rows
32. `components/layertimeline/layerlisttree.component.scss` -> Tailwind tree rows
33. `components/layertimeline/layerlisttree.component.ts` -> layer tree state/actions
34. `components/layertimeline/layertimeline.component.html` -> `LayerTimeline`
35. `components/layertimeline/layertimeline.component.scss` -> Tailwind timeline
36. `components/layertimeline/layertimeline.component.ts` -> timeline controller/store actions
37. `components/layertimeline/layertimelinegrid.directive.ts` -> timeline grid/scrub behavior
38. `components/layertimeline/timelineanimationrow.component.html` -> animation block rows
39. `components/layertimeline/timelineanimationrow.component.scss` -> Tailwind block rows
40. `components/layertimeline/timelineanimationrow.component.ts` -> block selection/edit behavior
41. `components/playback/_playback-theme.scss` -> Tailwind/Shadcn playback
42. `components/playback/index.ts` -> local exports not needed
43. `components/playback/playback.component.html` -> `CanvasArea` playback controls
44. `components/playback/playback.component.scss` -> Tailwind playback controls
45. `components/playback/playback.component.ts` -> store playback state/timing
46. `components/project/index.ts` -> local exports not needed
47. `components/project/project.service.ts` -> project serialization/import state
48. `components/propertyinput/InspectedProperty.ts` -> typed inspector property descriptors
49. `components/propertyinput/_propertyinput-theme.scss` -> Tailwind inspector
50. `components/propertyinput/index.ts` -> local exports not needed

## Porting Rules

- React/Shadcn is the shell; final behavior must match the original feature.
- No `lib/original`, no Angular source in `tsconfig`, and no `ts-nocheck`.
- CSS behavior is expressed with Tailwind and Shadcn tokens.
- When a faithful behavior depends on a missing model primitive, port the model primitive first.
