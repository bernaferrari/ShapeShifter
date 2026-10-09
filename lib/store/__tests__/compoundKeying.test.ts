import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";

const getStore = () => useEditorStore.getState();
const tracks = (layerId: string | number, property: string) =>
  getStore().animation.blocks.filter(
    (block) => String(block.layerId) === String(layerId) && block.propertyName === property,
  );

describe("compound properties key together", () => {
  beforeEach(() => {
    getStore().resetProject();
    useEditorStore.setState({ animation: { ...getStore().animation, blocks: [] }, progress: 0 });
  });

  it("keys animated Y at its current value when only X is edited", () => {
    const layerId = getStore().selectedLayerId;
    getStore().addKeyframeAtPlayhead(layerId, "translateX");
    getStore().addKeyframeAtPlayhead(layerId, "translateY");
    useEditorStore.setState({ progress: 1 });

    getStore().setPropertiesAtPlayhead(layerId, { translateX: 8 });

    expect(tracks(layerId, "translateX").some((block) => block.endTime === 1000)).toBe(true);
    const y = tracks(layerId, "translateY").find((block) => block.endTime === 1000);
    expect(y).toBeDefined();
    expect(Number(y!.toValue)).toBe(Number(y!.fromValue));
  });

  it("keys scale Y at 1 when only scale X is edited on an unscaled layer", () => {
    const layerId = getStore().selectedLayerId;
    getStore().addKeyframeAtPlayhead(layerId, "scaleX");
    getStore().addKeyframeAtPlayhead(layerId, "scaleY");
    useEditorStore.setState({ progress: 0.5 });

    getStore().setPropertiesAtPlayhead(layerId, { scaleX: 2 });

    const y = tracks(layerId, "scaleY").find((block) => block.endTime === 500);
    expect(Number(y?.toValue)).toBe(1);
  });

  it("leaves an unanimated dimension alone", () => {
    const layerId = getStore().selectedLayerId;
    getStore().addKeyframeAtPlayhead(layerId, "translateX");
    useEditorStore.setState({ progress: 1 });

    getStore().setPropertiesAtPlayhead(layerId, { translateX: 8 });

    expect(tracks(layerId, "translateY")).toHaveLength(0);
  });

  it("writes a keyframe at an explicit time without moving the playhead", () => {
    const layerId = getStore().selectedLayerId;
    getStore().addKeyframeAtPlayhead(layerId, "translateX");
    getStore().addKeyframeAtPlayhead(layerId, "translateY");
    useEditorStore.setState({ progress: 1 });
    getStore().setPropertiesAtPlayhead(layerId, { translateX: 4, translateY: 4 });
    useEditorStore.setState({ progress: 0.25 });

    getStore().setPropertiesAtPlayhead(layerId, { translateX: 9 }, { time: 1000 });

    expect(getStore().progress).toBe(0.25);
    const x = tracks(layerId, "translateX").find((block) => block.endTime === 1000);
    expect(Number(x?.toValue)).toBe(9);
  });
});
