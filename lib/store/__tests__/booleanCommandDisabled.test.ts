import { beforeEach, describe, expect, it } from "vitest";
import { BOOLEAN_OPERATIONS_ENABLED } from "../../shapeshifter/path/booleanOperations";
import { pathToString } from "../../shapeshifter/pathUtils";
import { useEditorStore } from "../editorStore";

describe("disabled Boolean store command", () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject();
  });

  it("is a no-op while the kernel is compiled off", () => {
    expect(BOOLEAN_OPERATIONS_ENABLED).toBe(false);
    const [first, second] = useEditorStore.getState().layers;
    useEditorStore.getState().selectLayers([first.id, second.id]);
    const before = useEditorStore.getState().layers.map((layer) => pathToString(layer.from));
    useEditorStore.getState().booleanCombine("intersect");
    useEditorStore.getState().booleanCombine("subtract");
    expect(useEditorStore.getState().layers.map((layer) => pathToString(layer.from))).toEqual(before);
    expect(useEditorStore.getState().layers).toHaveLength(before.length);
  });
});
