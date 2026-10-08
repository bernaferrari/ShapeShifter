import { buildEditorDocument, type WorkspaceSnapshot } from "../pathshift/documentModel";
import { createPathLayer } from "../store/defaultWorkspace";
import { generateId } from "../pathshift/ids";
import { parsePath, pathToString } from "../pathshift/pathUtils";
import { PAGE_ROOT_ID } from "../pathshift/scene/owners";
import { INTERPOLATOR_CURVES } from "../pathshift/interpolators";
import { validatePathData } from "../pathshift/path/pathValidation";
import { syncLayerPathEndpoints } from "../store/timelinePathEditing";
import type { Layer, TimelineBlock } from "../pathshift/types";

export class AgentCommandError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export type AgentCommand =
  | { type: "renameLayer"; ownerId: string; layerId: string | number; name: string }
  | {
      type: "setProperties";
      ownerId: string;
      layerId: string | number;
      properties: Record<string, unknown>;
    }
  | { type: "setPath"; ownerId: string; layerId: string | number; side: "from" | "to"; d: string }
  | { type: "createPath"; ownerId: string; name: string; d: string; parentId?: string | number }
  | { type: "setTimelineBlock"; ownerId: string; block: TimelineBlock }
  | { type: "removeTimelineBlock"; ownerId: string; blockId: string };

const numbers = new Set([
  "translateX",
  "translateY",
  "rotation",
  "pivotX",
  "pivotY",
  "scaleX",
  "scaleY",
  "alpha",
  "fillAlpha",
  "strokeAlpha",
  "strokeWidth",
  "trimPathStart",
  "trimPathEnd",
  "trimPathOffset",
]);
const unitValues = new Set(["alpha", "fillAlpha", "strokeAlpha", "trimPathStart", "trimPathEnd"]);
export const AGENT_EDITABLE_PROPERTIES = [
  ...numbers,
  "fillColor",
  "strokeColor",
  "visible",
  "locked",
  "fillType",
  "strokeLinecap",
  "strokeLinejoin",
];
const enums: Record<string, string[]> = {
  fillType: ["nonZero", "evenOdd"],
  strokeLinecap: ["butt", "round", "square"],
  strokeLinejoin: ["miter", "round", "bevel"],
};
const colorValid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?:#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8}|none|transparent)$/i.test(value);
const fail = (message: string): never => {
  throw new AgentCommandError("INVALID_COMMAND", message);
};
function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256)
    return fail("Names must contain 1–256 characters.");
  return value.trim();
}
export function validateAgentProperties(value: unknown): Partial<Layer> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("properties must be an object.");
  const properties = value as Record<string, unknown>;
  if (Object.keys(properties).length === 0) fail("properties must contain at least one edit.");
  for (const [key, entry] of Object.entries(properties)) {
    if (numbers.has(key)) {
      if (typeof entry !== "number" || !Number.isFinite(entry) || Math.abs(entry) > 1e7)
        fail(`${key} must be a finite number within ±10000000.`);
      if (unitValues.has(key) && (Number(entry) < 0 || Number(entry) > 1))
        fail(`${key} must be between 0 and 1.`);
      if (key === "strokeWidth" && Number(entry) < 0) fail("strokeWidth cannot be negative.");
    } else if (key === "fillColor" || key === "strokeColor") {
      if (!colorValid(entry)) fail(`${key} must be a hex color, none, or transparent.`);
    } else if (key === "visible" || key === "locked") {
      if (typeof entry !== "boolean") fail(`${key} must be boolean.`);
    } else if (
      !Object.hasOwn(enums, key) ||
      typeof entry !== "string" ||
      !enums[key]!.includes(entry)
    )
      fail(`Unsupported property or value: ${key}.`);
  }
  return properties as Partial<Layer>;
}

/** Strict input boundary: the editor's tolerant import parser must not silently accept agent mistakes. */
export function parseAgentPath(value: unknown) {
  const error = validatePathData(value);
  if (error) fail(error);
  return parsePath(value as string);
}

function validateInterpolator(value: unknown) {
  if (value == null) return;
  if (typeof value !== "string" || value.length > 256)
    return fail("interpolator must be a named easing or cubic Bézier.");
  if (Object.hasOwn(INTERPOLATOR_CURVES, value)) return;
  if (
    (value.includes("(") || value.includes(")")) &&
    (!value.trim().startsWith("cubic-bezier(") || !value.trim().endsWith(")"))
  )
    return fail("Custom easing must use cubic-bezier(x1, y1, x2, y2).");
  const match = value.match(
    /^\s*(?:cubic-bezier\(\s*)?([-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?)\s*(?:,|\s)\s*([-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?)\s*(?:,|\s)\s*([-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?)\s*(?:,|\s)\s*([-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?)\s*\)?\s*$/i,
  );
  const values = match?.slice(1).map(Number);
  if (
    !values ||
    values.some((entry) => !Number.isFinite(entry) || Math.abs(entry) > 1e7) ||
    values[0]! < 0 ||
    values[0]! > 1 ||
    values[2]! < 0 ||
    values[2]! > 1
  )
    fail("Use a named easing or cubic-bezier(x1, y1, x2, y2) with time controls between 0 and 1.");
}

function owner(snapshot: WorkspaceSnapshot, ownerId: string) {
  if (ownerId === PAGE_ROOT_ID)
    return { layers: snapshot.rootLayers, animation: snapshot.rootAnimation };
  const frame = snapshot.frames.find((candidate) => candidate.id === ownerId);
  if (!frame) throw new AgentCommandError("OWNER_NOT_FOUND", `Owner ${ownerId} does not exist.`);
  return frame;
}
function editableLayer(layers: Layer[], layerId: string | number, allowUnlock = false): Layer {
  const layer = layers.find((candidate) => String(candidate.id) === String(layerId));
  if (!layer) throw new AgentCommandError("LAYER_NOT_FOUND", `Layer ${layerId} does not exist.`);
  let current: Layer | undefined = layer;
  const seen = new Set<string>();
  while (current && !seen.has(String(current.id))) {
    if (current.locked && !(allowUnlock && current === layer))
      throw new AgentCommandError("LAYER_LOCKED", `Layer ${layerId} or its parent is locked.`);
    seen.add(String(current.id));
    current = layers.find((candidate) => String(candidate.id) === String(current!.parentId));
  }
  return layer;
}

/** Validate and stage the entire batch before the store or undo history changes. */
export function stageAgentCommands(source: WorkspaceSnapshot, commands: AgentCommand[]) {
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > 100)
    fail("Provide 1–100 commands per transaction.");
  const snapshot = structuredClone(source);
  const created: Array<{ ownerId: string; layerId: string }> = [];
  for (const command of commands) {
    if (!command || typeof command !== "object") fail("Each command must be an object.");
    const target = owner(snapshot, command.ownerId);
    switch (command.type) {
      case "renameLayer":
        editableLayer(target.layers, command.layerId).name = name(command.name);
        break;
      case "setProperties": {
        const patch = validateAgentProperties(command.properties);
        const unlockOnly = Object.keys(patch).length === 1 && patch.locked === false;
        Object.assign(editableLayer(target.layers, command.layerId, unlockOnly), patch);
        break;
      }
      case "setPath": {
        const layer = editableLayer(target.layers, command.layerId);
        if (layer.type !== "path" && layer.type !== "clipPath")
          fail("Only path layers have editable geometry.");
        if (command.side !== "from" && command.side !== "to") fail("side must be from or to.");
        const path = parseAgentPath(command.d);
        const geometry = pathToString(path);
        const before = { ...layer };
        const equivalent =
          layer[command.side] &&
          pathToString(layer[command.side]!) === geometry &&
          (command.side !== "from" || pathToString(layer.pathData ?? layer.from) === geometry);
        if (!equivalent) {
          layer[command.side] = path;
          if (command.side === "from") layer.pathData = path;
        }
        // Explicit intent also repairs a stale track when its base geometry is
        // already equal. Preserve that base's authored IDs for true no-op edits.
        const blocks = syncLayerPathEndpoints(
          before,
          layer,
          target.animation.blocks,
          undefined,
          command.side,
        );
        if (blocks !== target.animation.blocks) {
          target.animation.blocks = blocks;
        }
        break;
      }
      case "createPath": {
        const path = parseAgentPath(command.d);
        if (
          command.parentId != null &&
          editableLayer(target.layers, command.parentId).type !== "group"
        )
          fail("parentId must identify a group.");
        const id = generateId();
        target.layers.push(
          createPathLayer({
            id,
            name: name(command.name),
            from: path,
            pathData: path,
            parentId: command.parentId ?? null,
            visible: true,
            locked: false,
            fillColor: "#111111",
          }),
        );
        created.push({ ownerId: command.ownerId, layerId: id });
        break;
      }
      case "setTimelineBlock": {
        const block = structuredClone(command.block);
        if (!block || typeof block.id !== "string" || !block.id || block.id.length > 256)
          fail("Timeline blocks require a stable id.");
        editableLayer(target.layers, block.layerId);
        const previous = target.animation.blocks.find((candidate) => candidate.id === block.id);
        if (previous) editableLayer(target.layers, previous.layerId);
        if (
          !Number.isFinite(block.startTime) ||
          !Number.isFinite(block.endTime) ||
          block.startTime < 0 ||
          block.startTime >= block.endTime ||
          block.endTime > target.animation.duration
        )
          fail("Block times must satisfy 0 ≤ start < end ≤ duration.");
        if (block.propertyName === "pathData") {
          parseAgentPath(block.fromValue);
          parseAgentPath(block.toValue);
          block.type = "path";
        } else {
          if (
            !numbers.has(block.propertyName) &&
            block.propertyName !== "fillColor" &&
            block.propertyName !== "strokeColor"
          )
            fail("Unsupported animated property.");
          validateAgentProperties({ [block.propertyName]: block.fromValue });
          validateAgentProperties({ [block.propertyName]: block.toValue });
          block.type = numbers.has(block.propertyName) ? "number" : "color";
        }
        validateInterpolator(block.interpolator);
        const index = target.animation.blocks.findIndex((candidate) => candidate.id === block.id);
        if (index >= 0) target.animation.blocks[index] = block;
        else target.animation.blocks.push(block);
        break;
      }
      case "removeTimelineBlock": {
        const block = target.animation.blocks.find((candidate) => candidate.id === command.blockId);
        if (!block) fail(`Timeline block ${command.blockId} does not exist.`);
        editableLayer(target.layers, block!.layerId);
        target.animation.blocks = target.animation.blocks.filter(
          (candidate) => candidate.id !== command.blockId,
        );
        break;
      }
      default:
        fail("Unsupported command type.");
    }
  }
  return { document: buildEditorDocument(snapshot), created };
}

export function agentLayerSummary(layer: Layer) {
  const { from, to, pathData, children: _children, morphMapping: _mapping, ...properties } = layer;
  return { ...properties, from: pathToString(pathData ?? from), to: to ? pathToString(to) : null };
}
