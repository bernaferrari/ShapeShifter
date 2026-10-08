import { create } from "zustand";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath } from "@/lib/pathshift/pathUtils";
import { generateId } from "@/lib/pathshift/ids";
import { createPathLayer } from "@/lib/store/defaultWorkspace";

interface ExerciseState {
  ownerId: string | null;
  layerId: string | null;
  previewed: boolean;
  exported: boolean;
  start: () => void;
  close: () => void;
}
/** Volatile tutorial progress; the practice artwork is an ordinary editable artboard. */
export const useAnimationExercise = create<ExerciseState>((set) => ({
  ownerId: null,
  layerId: null,
  previewed: false,
  exported: false,
  close: () => set({ ownerId: null, layerId: null }),
  start: () => {
    const store = useEditorStore.getState();
    store.beginHistoryGesture();
    try {
      store.addFrame();
      const next = useEditorStore.getState();
      const id = generateId();
      const icon = createPathLayer({
        id,
        name: "Moving icon",
        type: "path",
        from: parsePath("M4 8 L12 8 L12 5 L18 12 L12 19 L12 16 L4 16 Z"),
        fillColor: "#6366f1",
        visible: true,
        locked: false,
      });
      useEditorStore.setState({
        layers: [icon],
        animation: { ...next.animation, duration: 1000, blocks: [] },
        hiddenLayerIds: [],
        progress: 0,
        selectedBlockIds: [],
        toolMode: "select",
      });
      useEditorStore
        .getState()
        .updateVector({
          name: "Make this icon move",
          width: 32,
          height: 24,
          viewportWidth: 32,
          viewportHeight: 24,
        });
      useEditorStore.getState().selectLayers([id]);
      useEditorStore.getState().fitWorldToFrames([next.selectedFrameId]);
      set({ ownerId: next.selectedFrameId, layerId: id, previewed: false, exported: false });
    } finally {
      useEditorStore.getState().endHistoryGesture();
    }
  },
}));

/** Only a completed download of the exercise's motion format counts as its export step. */
export function recordExerciseExport(ownerId: string, kind: string) {
  const exercise = useAnimationExercise.getState();
  if (exercise.ownerId === ownerId && ["avd", "lottie", "json"].includes(kind))
    useAnimationExercise.setState({ exported: true });
}
