import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditorAgent } from "../editorAgent";
import { AgentCommandError, parseAgentPath, validateAgentProperties } from "../commands";
import { AGENT_EXPORT_FORMATS } from "../export";
import { EDITOR_AGENT_TOOLS } from "../browserTools";
import { pathToString } from "../../shapeshifter/pathUtils";
import { compileAndroidArtboard } from "../../shapeshifter/androidCompiler";
import { workspaceFromDocument } from "../../shapeshifter/documentModel";
import { useEditorStore } from "../../store/editorStore";

let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.setState({ history: [], future: [], canUndo: false, isPlaying: false });
});
afterEach(() => useEditorStore.setState(baseline, true));
const ref = () => ({
  ownerId: useEditorStore.getState().selectedFrameId,
  layerId: useEditorStore.getState().layers[0]!.id,
});

describe("agent document transactions", () => {
  it("returns detached inspection values, including inactive metadata and selection", () => {
    const agent = createEditorAgent();
    const before = agent.inspect();
    const copy = agent.inspect();
    copy.selection.layers.length = 0;
    copy.selection.frameIds.push("mutated");
    for (const owner of copy.owners) {
      owner.vector.alpha = 0;
      owner.animation.blocks.length = 0;
    }
    copy.document.name = "mutated";
    expect(agent.inspect()).toEqual(before);
  });
  it("applies a multi-owner batch atomically and undoes all changes once", () => {
    const agent = createEditorAgent();
    const initial = agent.inspect();
    const other = initial.owners.find(
      (owner) => owner.id !== initial.playhead.ownerId && owner.layers.length,
    )!;
    const firstName = useEditorStore.getState().layers[0]!.name;
    const selectedFrameId = useEditorStore.getState().selectedFrameId;
    const result = agent.apply({
      expectedRevision: initial.revision,
      commands: [
        { type: "renameLayer", ...ref(), name: "Agent shape" },
        {
          type: "setProperties",
          ownerId: other.id,
          layerId: other.layers[0]!.id,
          properties: { fillColor: "#ff3300", translateX: 2.5 },
        },
      ],
    });
    expect(result.changed).toBe(true);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().layers[0]!.name).toBe("Agent shape");
    expect(useEditorStore.getState().selectedFrameId).toBe(selectedFrameId);
    agent.undo({ expectedRevision: result.revision });
    expect(useEditorStore.getState().layers[0]!.name).toBe(firstName);
    expect(agent.inspect().document).toEqual(initial.document);
  });
  it("fails the entire batch when a later command is invalid", () => {
    const agent = createEditorAgent();
    const before = agent.inspect();
    expect(() =>
      agent.apply({
        expectedRevision: before.revision,
        commands: [
          { type: "renameLayer", ...ref(), name: "Must not apply" },
          { type: "setProperties", ...ref(), properties: { alpha: 9 } },
        ],
      }),
    ).toThrow(AgentCommandError);
    expect(agent.inspect().document).toEqual(before.document);
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
  it("rejects a stale revision after human editing but allows camera/playhead changes", () => {
    const agent = createEditorAgent();
    const before = agent.inspect();
    useEditorStore.getState().setProgress(0.5);
    useEditorStore.getState().selectLayer(useEditorStore.getState().layers[1]!.id);
    expect(agent.inspect().revision).toBe(before.revision);
    useEditorStore.getState().updateSelectedLayer({ translateX: 7 });
    expect(() =>
      agent.apply({
        expectedRevision: before.revision,
        commands: [{ type: "renameLayer", ...ref(), name: "Stale" }],
      }),
    ).toThrow(/Inspect again/);
  });
  it("evaluates an animated transform using the same scene semantics as preview", () => {
    const agent = createEditorAgent();
    const current = agent.inspect();
    agent.apply({
      expectedRevision: current.revision,
      commands: [
        {
          type: "setTimelineBlock",
          ownerId: ref().ownerId,
          block: {
            id: "agent-motion",
            layerId: ref().layerId,
            propertyName: "translateX",
            fromValue: 0,
            toValue: 20,
            startTime: 0,
            endTime: 1000,
            interpolator: "LINEAR",
          },
        },
      ],
    });
    expect(
      agent
        .evaluate({ ownerId: ref().ownerId, timeMs: 500 })
        .nodes.find((node) => String(node.id) === String(ref().layerId))!.transform.translateX,
    ).toBe(10);
  });
  it("avoids undo entries for no-op edits and rejects active gestures", () => {
    const agent = createEditorAgent();
    const current = agent.inspect();
    const result = agent.apply({
      expectedRevision: current.revision,
      commands: [
        { type: "renameLayer", ...ref(), name: useEditorStore.getState().layers[0]!.name },
      ],
    });
    expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history).toHaveLength(0);
    useEditorStore.getState().beginHistoryGesture();
    expect(() =>
      agent.apply({
        expectedRevision: current.revision,
        commands: [{ type: "renameLayer", ...ref(), name: "Busy" }],
      }),
    ).toThrow(/Finish the current gesture/);
  });
  it("preserves locked layers and rejects malformed paths rather than partial imports", () => {
    const agent = createEditorAgent();
    useEditorStore.getState().updateSelectedLayer({ locked: true });
    const current = agent.inspect();
    expect(() =>
      agent.apply({
        expectedRevision: current.revision,
        commands: [{ type: "renameLayer", ...ref(), name: "Locked" }],
      }),
    ).toThrow(/locked/);
    for (const d of ["M 0", "M0 0 L1", "M0 0 garbage", "L0 0", "M0 0 L Infinity 1"])
      expect(() => parseAgentPath(d)).toThrow();
    expect(parseAgentPath("M0 0 L10 0 L10 10 Z").subPaths).toHaveLength(1);
  });
  it("does not replace a locked layer's existing timeline block via a new unlocked target", () => {
    const agent = createEditorAgent();
    const [first, second] = useEditorStore.getState().layers;
    const firstRef = { ownerId: ref().ownerId, layerId: first!.id };
    agent.apply({
      expectedRevision: agent.inspect().revision,
      commands: [
        {
          type: "setTimelineBlock",
          ownerId: firstRef.ownerId,
          block: {
            id: "locked-motion",
            layerId: first!.id,
            propertyName: "translateX",
            fromValue: 0,
            toValue: 10,
            startTime: 0,
            endTime: 1000,
            interpolator: "LINEAR",
          },
        },
        { type: "setProperties", ...firstRef, properties: { locked: true } },
      ],
    });
    const before = agent.inspect();
    const historyLength = useEditorStore.getState().history.length;
    expect(() =>
      agent.apply({
        expectedRevision: before.revision,
        commands: [
          {
            type: "setTimelineBlock",
            ownerId: firstRef.ownerId,
            block: {
              id: "locked-motion",
              layerId: second!.id,
              propertyName: "translateX",
              fromValue: 0,
              toValue: 20,
              startTime: 0,
              endTime: 1000,
            },
          },
        ],
      }),
    ).toThrow(/locked/);
    expect(agent.inspect().document).toEqual(before.document);
    expect(useEditorStore.getState().history).toHaveLength(historyLength);
  });
  it("preserves authored geometry IDs for equivalent setPath commands", () => {
    const agent = createEditorAgent();
    const before = agent.inspect();
    const result = agent.apply({
      expectedRevision: before.revision,
      commands: [
        {
          type: "setPath",
          ...ref(),
          side: "from",
          d: pathToString(useEditorStore.getState().layers[0]!.from),
        },
      ],
    });
    expect(result.changed).toBe(false);
    expect(agent.inspect()).toEqual(before);
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
  it("authors explicit outer path keyframes with one undo and preserves middle tracks and owner scope", () => {
    const agent = createEditorAgent();
    const state = useEditorStore.getState();
    const target = ref();
    const path = (x: number) => pathToString(parseAgentPath(`M${x} 0L${x + 8} 0L${x + 4} 8Z`));
    const block = (id: string, startTime: number, endTime: number, x: number) => ({
      id,
      layerId: target.layerId,
      propertyName: "pathData",
      fromValue: path(x),
      toValue: path(x + 1),
      startTime,
      endTime,
      interpolator: "LINEAR",
      type: "path" as const,
    });
    const blocks = [
      block("boundary-last", 700, 900, 6),
      block("boundary-middle", 400, 600, 3),
      block("boundary-first", 100, 300, 0),
      { ...block("other-layer-path", 0, 1000, 10), layerId: state.layers[1]!.id },
    ];
    const otherOwner = state.frames.find((frame) => frame.id !== target.ownerId)!;
    useEditorStore.setState({
      layers: state.layers.map((layer) =>
        String(layer.id) === String(target.layerId)
          ? {
              ...layer,
              from: parseAgentPath(path(0)),
              pathData: parseAgentPath(path(0)),
              to: parseAgentPath(path(7)),
            }
          : layer,
      ),
      animation: { ...state.animation, blocks },
      frames: state.frames.map((frame) =>
        frame.id === otherOwner.id
          ? {
              ...frame,
              layers: [{ ...state.layers[0]!, id: target.layerId }],
              animation: { ...frame.animation, blocks: [block("boundary-first", 0, 1000, 20)] },
            }
          : frame,
      ),
    });
    const before = agent.inspect();
    const from = pathToString(parseAgentPath(path(2)));
    const to = pathToString(parseAgentPath(path(9)));
    const applied = agent.apply({
      expectedRevision: before.revision,
      commands: [
        { type: "setPath", ...target, side: "from", d: from },
        { type: "setPath", ...target, side: "to", d: to },
      ],
    });
    expect(applied.changed).toBe(true);
    expect(useEditorStore.getState().history).toHaveLength(1);
    const after = agent.inspect();
    const active = after.owners.find((owner) => owner.id === target.ownerId)!;
    const previous = before.owners.find((owner) => owner.id === target.ownerId)!;
    for (const original of previous.animation.blocks) {
      const authored = active.animation.blocks.find((candidate) => candidate.id === original.id)!;
      expect(authored).toEqual({
        ...original,
        ...(original.id === "boundary-first" && { fromValue: from }),
        ...(original.id === "boundary-last" && { toValue: to }),
      });
    }
    expect(
      workspaceFromDocument(after.document).frames.find((frame) => frame.id === otherOwner.id),
    ).toEqual(
      workspaceFromDocument(before.document).frames.find((frame) => frame.id === otherOwner.id),
    );
    const at = (timeMs: number) =>
      agent
        .evaluate({ ownerId: target.ownerId, timeMs })
        .nodes.find((node) => String(node.id) === String(target.layerId))!.d;
    expect(at(0)).toBe(from);
    expect(at(1000)).toBe(to);
    const staticExport = agent.exportDocument({ ownerId: target.ownerId, format: "static" });
    expect(staticExport.ready).toBe(true);
    expect(staticExport.content).toContain(`d="${from}"`);
    const owner = workspaceFromDocument(after.document).frames.find(
      (frame) => frame.id === target.ownerId,
    )!;
    const android = compileAndroidArtboard(owner);
    expect(android.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const animatorFiles = android.files.filter((file) => file.path.includes("/animator/"));
    expect(animatorFiles.some((file) => file.content.includes(`android:valueFrom="${from}"`))).toBe(
      true,
    );
    expect(animatorFiles.some((file) => file.content.includes(`android:valueTo="${to}"`))).toBe(
      true,
    );
    agent.undo({ expectedRevision: applied.revision });
    expect(agent.inspect().document).toEqual(before.document);
  });
  it("repairs a stale explicit From even when setPath matches base geometry and then becomes a no-op", () => {
    const agent = createEditorAgent();
    const state = useEditorStore.getState();
    const target = ref();
    const d = pathToString(state.layers[0]!.pathData ?? state.layers[0]!.from);
    useEditorStore.setState({
      animation: {
        ...state.animation,
        blocks: state.animation.blocks.map((block) =>
          String(block.layerId) === String(target.layerId) && block.propertyName === "pathData"
            ? { ...block, fromValue: pathToString(parseAgentPath("M0 0L8 0L4 8Z")) }
            : block,
        ),
      },
    });
    const before = agent.inspect();
    const command = { type: "setPath" as const, ...target, side: "from" as const, d };
    const applied = agent.apply({ expectedRevision: before.revision, commands: [command] });
    expect(applied.changed).toBe(true);
    const after = agent.inspect();
    const geometryId = Object.values(before.document.nodes).find(
      (node) =>
        node.id ===
        `node:${encodeURIComponent(target.ownerId)}:${encodeURIComponent(String(target.layerId))}`,
    )!.geometryVersionId;
    expect(after.document.geometryVersions[geometryId!]).toEqual(
      before.document.geometryVersions[geometryId!],
    );
    expect(
      agent
        .evaluate({ ownerId: target.ownerId, timeMs: 0 })
        .nodes.find((node) => String(node.id) === String(target.layerId))!.d,
    ).toBe(d);
    expect(agent.apply({ expectedRevision: applied.revision, commands: [command] }).changed).toBe(
      false,
    );
    expect(useEditorStore.getState().history).toHaveLength(1);
    agent.undo({ expectedRevision: applied.revision });
    expect(agent.inspect().document).toEqual(before.document);
  });
  it("rejects malformed property and easing inputs without changing document or history", () => {
    for (const properties of [{}, { fillType: 2 }, JSON.parse('{"constructor":"x"}')])
      expect(() => validateAgentProperties(properties)).toThrow(AgentCommandError);
    expect(() => parseAgentPath("M0 0 L1e308 0")).toThrow(AgentCommandError);
    const agent = createEditorAgent();
    const before = agent.inspect();
    for (const interpolator of [
      "garbage",
      "cubic-bezier(2,0,1,1)",
      "cubic-bezier(0,0,1,Infinity)",
      "cubic-bezier(0,0,1,1",
    ]) {
      expect(() =>
        agent.apply({
          expectedRevision: before.revision,
          commands: [
            {
              type: "setTimelineBlock",
              ownerId: ref().ownerId,
              block: {
                id: "invalid",
                layerId: ref().layerId,
                propertyName: "translateX",
                fromValue: 0,
                toValue: 10,
                startTime: 0,
                endTime: 1000,
                interpolator,
              },
            },
          ],
        }),
      ).toThrow(AgentCommandError);
    }
    expect(agent.inspect().document).toEqual(before.document);
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
  it("redos one atomic batch and rejects stale redo revisions", () => {
    const agent = createEditorAgent();
    const applied = agent.apply({
      expectedRevision: agent.inspect().revision,
      commands: [{ type: "renameLayer", ...ref(), name: "Redo name" }],
    });
    const undone = agent.undo({ expectedRevision: applied.revision });
    expect(() => agent.redo({ expectedRevision: applied.revision })).toThrow(/Inspect again/);
    const redone = agent.redo({ expectedRevision: undone.revision });
    expect(useEditorStore.getState().layers[0]!.name).toBe("Redo name");
    expect(redone.revision).toBeGreaterThan(undone.revision);
  });
});

describe("agent captured exports", () => {
  it("exports an explicit inactive owner without moving selection, playhead, or history", () => {
    const agent = createEditorAgent();
    const before = agent.inspect();
    const owner = before.owners.find(
      (candidate) => candidate.id !== before.playhead.ownerId && candidate.layers.length,
    )!;
    const storeBefore = useEditorStore.getState();
    const result = agent.exportDocument({ ownerId: owner.id, format: "static" });
    expect(result).toMatchObject({
      scope: "owner",
      artwork: "base",
      ownerId: owner.id,
      ready: true,
      mimeType: "image/svg+xml",
      encoding: "utf-8",
      revision: before.revision,
    });
    expect(result.byteLength).toBe(new TextEncoder().encode(result.content!).byteLength);
    expect(result.content).toContain("<svg");
    expect(useEditorStore.getState()).toBe(storeBefore);
    expect(agent.inspect()).toEqual(before);
  });
  it("exports a lossless whole document JSON capture and reports its scope", () => {
    const agent = createEditorAgent();
    const before = agent.inspect();
    const result = agent.exportDocument({ ownerId: ref().ownerId, format: "json" });
    expect(result.scope).toBe("document");
    expect(JSON.parse(result.content!).document).toEqual(before.document);
  });
  it("provides text formats and portable base64 bytes for a complete Android archive", () => {
    const agent = createEditorAgent();
    // A simple owner with no imported animation yields no blocking diagnostics.
    useEditorStore.setState({
      layers: [useEditorStore.getState().layers[0]!],
      animation: { ...useEditorStore.getState().animation, blocks: [] },
    });
    for (const format of AGENT_EXPORT_FORMATS) {
      const result = agent.exportDocument({ ownerId: ref().ownerId, format });
      expect(result.ready).toBe(true);
      expect(result.content).toBeTruthy();
      if (format === "avd") {
        const bytes = atob(result.content!);
        expect(bytes.slice(0, 2)).toBe("PK");
        expect(result.byteLength).toBe(bytes.length);
        expect(result.encoding).toBe("base64");
      }
    }
    expect(EDITOR_AGENT_TOOLS.map((tool) => tool.name)).toContain("shapeshifter_export");
    expect(EDITOR_AGENT_TOOLS.map((tool) => tool.name)).toContain("shapeshifter_redo");
  });
  it("surfaces blocking Android diagnostics instead of returning a broken downloadable asset", () => {
    const agent = createEditorAgent();
    const state = useEditorStore.getState();
    useEditorStore.setState({
      animation: {
        ...state.animation,
        blocks: [
          {
            id: "invalid-track",
            layerId: state.layers[0]!.id,
            propertyName: "pathData",
            fromValue: "M0 0L20 0Z",
            toValue: "M0 0C5 10 15 10 20 0Z",
            startTime: 0,
            endTime: 1000,
          },
        ],
      },
    });
    const result = agent.exportDocument({ ownerId: ref().ownerId, format: "avd" });
    expect(result.ready).toBe(false);
    expect(result.content).toBeNull();
    expect(result.byteLength).toBe(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
  });
  it("rejects unknown owner and format requests without changing state", () => {
    const agent = createEditorAgent();
    const before = useEditorStore.getState();
    expect(() => agent.exportDocument({ ownerId: "unknown", format: "pdf" })).toThrow(
      /does not exist/,
    );
    expect(() =>
      agent.exportDocument({ ownerId: ref().ownerId, format: "bogus" as "pdf" }),
    ).toThrow(/supported export format/);
    expect(useEditorStore.getState()).toBe(before);
  });
});
