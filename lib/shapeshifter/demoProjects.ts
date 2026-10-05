import heartbreak from "./demos/heartbreak.json";
import morphinganimals from "./demos/morphinganimals.json";
import playtopause from "./demos/playtopause.json";
import searchtoclose from "./demos/searchtoclose.json";
import visibilitystrike from "./demos/visibilitystrike.json";
import { workspaceFromDocument } from "./documentModel";
import type { EditorDocument } from "./types";

export const DEMO_INFOS = [
  { id: "playtopause", title: "Play-to-pause", project: playtopause },
  { id: "searchtoclose", title: "Search-to-close", project: searchtoclose },
  { id: "morphinganimals", title: "Morphing animals", project: morphinganimals },
  { id: "visibilitystrike", title: "Visibility strike", project: visibilitystrike },
  { id: "heartbreak", title: "Heart break", project: heartbreak },
] as const;

export function getDemoProject(index: number) {
  const wrappedIndex = ((index % DEMO_INFOS.length) + DEMO_INFOS.length) % DEMO_INFOS.length;
  const demo = DEMO_INFOS[wrappedIndex];
  return {
    info: demo,
    project: (() => {
      const frame = workspaceFromDocument(demo.project.document as unknown as EditorDocument)
        .frames[0]!;
      return {
        layers: frame.layers,
        vector: frame.vector,
        animation: frame.animation,
        hiddenLayerIds: frame.hiddenLayerIds,
      };
    })(),
  };
}
