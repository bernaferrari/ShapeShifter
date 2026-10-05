# ShapeShifter project file

Project downloads (`*.shapeshifter`) and local recovery snapshots use one native format:

```json
{
  "format": "shapeshifter",
  "document": { "schema": "shapeshifter", "...": "authored document graph" },
  "activeOwnerId": "artboard ID or __page_root__"
}
```

`document` contains the page, ordered artboards, nodes, geometry, styles, animation clips, tracks, and keyframes. `activeOwnerId` restores the editing and export context; it is optional for programmatically generated files.

There is no legacy envelope, versioned parallel model, migration, or fallback. Invalid references, invalid geometry, and unsupported document features fail import with a diagnostic. Old ShapeShifter JSON files are not accepted. SVG and Android XML import remain supported interchange formats.

All document writes publish the authored graph and editor views in one transaction. History stores the graph with selection context. Exports and recovery read the committed graph without changing the document or creating undo entries. The workspace views are transient editing indexes, not a second serialized project.

Motion is stored once, in document tracks and keyframes. Timeline segments join two endpoints; a retained single pose has one keyframe. Deleting a keyframe preserves the other poses. Removing an entire property animation is a separate command.

See `lib/shapeshifter/types.ts` (`EditorDocument`), `lib/shapeshifter/documentModel.ts`, and `lib/store/exportDocument.ts`.
