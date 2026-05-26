import heartbreak from "./demos/heartbreak.json";
import morphinganimals from "./demos/morphinganimals.json";
import playtopause from "./demos/playtopause.json";
import searchtoclose from "./demos/searchtoclose.json";
import visibilitystrike from "./demos/visibilitystrike.json";
import { flattenOriginalProject, type ShapeShifterProject } from "./project";

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
    project: flattenOriginalProject(demo.project as ShapeShifterProject),
  };
}
