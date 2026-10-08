# Pathshift project file

Project downloads (`*.pathshift`) and local recovery snapshots use one native format:

```json
{
  "format": "pathshift",
  "document": { "schema": "pathshift", "...": "authored document graph" },
  "activeOwnerId": "artboard ID or __page_root__"
}
```

`document` contains the page, ordered artboards, nodes, geometry, styles, animation clips, tracks, and keyframes. `activeOwnerId` restores the editing and export context; it is optional for programmatically generated files.

Imports validate references, geometry, and supported document features before opening the document. Invalid files fail with a diagnostic. SVG and Android XML remain supported interchange formats.

All document writes publish the authored graph and editor views in one transaction. History stores the graph with selection context. Exports and recovery read the committed graph without changing the document or creating undo entries. The workspace views are transient editing indexes, not a second serialized project.

Motion is stored once, in document tracks and keyframes. Timeline segments join two endpoints; a retained single pose has one keyframe. Deleting a keyframe preserves the other poses. Removing an entire property animation is a separate command.

See `lib/pathshift/types.ts` (`EditorDocument`), `lib/pathshift/documentModel.ts`, and `lib/store/exportDocument.ts`.
