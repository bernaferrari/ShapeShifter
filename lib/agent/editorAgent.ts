import { useEditorStore } from "../store/editorStore";
import {
  commitDocumentV2,
  historySessionFromEditor,
  legacySnapshotFromEditor,
  restoreHistoryEntry,
} from "../store/documentRuntime";
import { legacySnapshotFromDocumentV2 } from "../shapeshifter/documentModel";
import { evaluateAndroidScene } from "../shapeshifter/scene/evaluate";
import { getEvaluatedNodeBounds } from "../shapeshifter/scene/selection";
import { PAGE_ROOT_ID } from "../shapeshifter/scene/owners";
import {
  AGENT_EDITABLE_PROPERTIES,
  AgentCommandError,
  agentLayerSummary,
  stageAgentCommands,
  type AgentCommand,
} from "./commands";
import { AGENT_EXPORT_FORMATS, exportAgentSnapshot, type AgentExportRequest } from "./export";

/** Content revisions are calculated at the boundary, never during playback renders. */
export function createEditorAgent() {
  let revision = 0;
  let previous = "";
  const snapshot = () => {
    const document = commitDocumentV2(useEditorStore.getState());
    const signature = JSON.stringify(document);
    if (previous && previous !== signature) revision++;
    previous = signature;
    return { document, revision };
  };
  const assertRevision = (expected: unknown) => {
    const current = snapshot();
    if (!Number.isSafeInteger(expected) || expected !== current.revision) {
      throw new AgentCommandError(
        "REVISION_CONFLICT",
        `Document revision is ${current.revision}. Inspect again before editing.`,
      );
    }
    const state = useEditorStore.getState();
    if (state.historyGestureActive || state.dragState || state.isPlaying) {
      throw new AgentCommandError(
        "EDITOR_BUSY",
        "Finish the current gesture or pause playback before editing.",
      );
    }
    return current;
  };
  return {
    inspect() {
      const current = snapshot();
      const state = useEditorStore.getState();
      const legacy = legacySnapshotFromEditor(state);
      return structuredClone({
        apiVersion: 1,
        documentId: current.document.id,
        revision: current.revision,
        capabilities: {
          commands: [
            "renameLayer",
            "setProperties",
            "setPath",
            "createPath",
            "setTimelineBlock",
            "removeTimelineBlock",
          ],
          properties: AGENT_EDITABLE_PROPERTIES,
          atomicBatches: true,
          maxCommands: 100,
          undo: true,
          redo: true,
          exportFormats: AGENT_EXPORT_FORMATS,
        },
        selection: {
          kind: state.selectionKind,
          layers: state.selectedLayerRefs,
          frameIds: state.selectedFrameIds,
        },
        playhead: {
          ownerId: state.selectedFrameId,
          timeMs: state.progress * state.animation.duration,
          playing: state.isPlaying,
        },
        owners: [
          {
            id: PAGE_ROOT_ID,
            name: legacy.rootVector.name,
            origin: { x: 0, y: 0 },
            vector: legacy.rootVector,
            animation: legacy.rootAnimation,
            layers: legacy.rootLayers.map(agentLayerSummary),
          },
          ...legacy.frames.map((frame) => ({
            id: frame.id,
            name: frame.name,
            origin: { x: frame.x, y: frame.y },
            vector: frame.vector,
            animation: frame.animation,
            layers: frame.layers.map(agentLayerSummary),
          })),
        ],
        document: structuredClone(current.document),
      });
    },
    evaluate({ ownerId, timeMs }: { ownerId: string; timeMs: number }) {
      const current = snapshot();
      const legacy = legacySnapshotFromDocumentV2(current.document);
      const owner =
        ownerId === PAGE_ROOT_ID
          ? {
              layers: legacy.rootLayers,
              animation: legacy.rootAnimation,
              vector: legacy.rootVector,
            }
          : legacy.frames.find((frame) => frame.id === ownerId);
      if (!owner)
        throw new AgentCommandError("OWNER_NOT_FOUND", `Owner ${ownerId} does not exist.`);
      if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > owner.animation.duration)
        throw new AgentCommandError("INVALID_TIME", "timeMs must be within the owner's duration.");
      const scene = evaluateAndroidScene(
        owner.layers,
        owner.animation,
        timeMs / owner.animation.duration,
      );
      return {
        documentId: current.document.id,
        revision: current.revision,
        ownerId,
        timeMs,
        vector: owner.vector,
        nodes: scene.nodes.map((node) => ({
          id: node.id,
          parentId: node.parentId,
          name: node.layer.name,
          type: node.type,
          visible: node.visible,
          locked: node.locked,
          transform: node.transform,
          worldMatrix: node.worldMatrix,
          bounds: getEvaluatedNodeBounds(scene, node.id),
          d: node.d,
          fill: node.fill,
          fillGradient: node.fillGradient,
          fillType: node.fillType,
          stroke: node.stroke,
          fillOpacity: node.fillOpacity,
          strokeOpacity: node.strokeOpacity,
          strokeWidth: node.strokeWidth,
          strokeLinecap: node.strokeLinecap,
          strokeLinejoin: node.strokeLinejoin,
          strokeMiterLimit: node.strokeMiterLimit,
          strokeDasharray: node.strokeDasharray,
          trimPathStart: node.trimPathStart,
          trimPathEnd: node.trimPathEnd,
          trimPathOffset: node.trimPathOffset,
          clipNodeIds: node.clipNodeIds,
        })),
      };
    },
    exportDocument(request: AgentExportRequest) {
      const current = snapshot();
      return exportAgentSnapshot(current.document, current.revision, request);
    },
    apply({ expectedRevision, commands }: { expectedRevision: number; commands: AgentCommand[] }) {
      const current = assertRevision(expectedRevision);
      const state = useEditorStore.getState();
      const staged = stageAgentCommands(legacySnapshotFromEditor(state), commands);
      if (JSON.stringify(staged.document) === JSON.stringify(current.document))
        return { revision: current.revision, changed: false, created: [] };
      // Staging is synchronous. Validation completes before the sole history push
      // and state replacement, so observers never see a partially applied batch.
      state.pushHistory();
      useEditorStore.setState(
        restoreHistoryEntry(state, {
          documentV2: staged.document,
          session: historySessionFromEditor(state),
        }),
      );
      return { revision: snapshot().revision, changed: true, created: staged.created };
    },
    select({
      expectedRevision,
      layers,
    }: {
      expectedRevision: number;
      layers: Array<{ ownerId: string; layerId: string | number }>;
    }) {
      assertRevision(expectedRevision);
      const source = legacySnapshotFromEditor(useEditorStore.getState());
      if (!Array.isArray(layers) || layers.length > 1000)
        throw new AgentCommandError(
          "INVALID_SELECTION",
          "layers must contain at most 1000 references.",
        );
      for (const ref of layers) {
        const owner =
          ref.ownerId === PAGE_ROOT_ID
            ? source.rootLayers
            : source.frames.find((frame) => frame.id === ref.ownerId)?.layers;
        if (!owner?.some((layer) => String(layer.id) === String(ref.layerId)))
          throw new AgentCommandError(
            "LAYER_NOT_FOUND",
            `Selection layer ${ref.layerId} does not exist in ${ref.ownerId}.`,
          );
      }
      useEditorStore.getState().selectLayerRefs(layers);
      return {
        revision: snapshot().revision,
        selectedLayers: structuredClone(useEditorStore.getState().selectedLayerRefs),
      };
    },
    undo({ expectedRevision }: { expectedRevision: number }) {
      assertRevision(expectedRevision);
      if (!useEditorStore.getState().canUndo)
        throw new AgentCommandError("NOTHING_TO_UNDO", "No undo transaction is available.");
      useEditorStore.getState().undo();
      return { revision: snapshot().revision };
    },
    redo({ expectedRevision }: { expectedRevision: number }) {
      assertRevision(expectedRevision);
      if (!useEditorStore.getState().canRedo)
        throw new AgentCommandError("NOTHING_TO_REDO", "No redo transaction is available.");
      useEditorStore.getState().redo();
      return { revision: snapshot().revision };
    },
  };
}

export type EditorAgent = ReturnType<typeof createEditorAgent>;
