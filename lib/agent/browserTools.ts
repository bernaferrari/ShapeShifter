import { AgentCommandError } from "./commands";
import { createEditorAgent } from "./editorAgent";
import { AGENT_EXPORT_FORMATS } from "./export";

export const editorAgent = createEditorAgent();
const id = { type: ["string", "number"] };
const string = { type: "string" };
const objectSchema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const ownerLayer = { ownerId: string, layerId: id };
const command = (type: string, properties: Record<string, unknown>) =>
  objectSchema({ type: { const: type }, ...properties });
export const AGENT_BATCH_SCHEMA = objectSchema({
  expectedRevision: { type: "integer", minimum: 0 },
  commands: {
    type: "array",
    minItems: 1,
    maxItems: 100,
    items: {
      oneOf: [
        command("renameLayer", { ...ownerLayer, name: string }),
        command("setProperties", {
          ...ownerLayer,
          properties: { type: "object", minProperties: 1 },
        }),
        command("setPath", { ...ownerLayer, side: { enum: ["from", "to"] }, d: string }),
        objectSchema(
          { type: { const: "createPath" }, ownerId: string, name: string, d: string, parentId: id },
          ["type", "ownerId", "name", "d"],
        ),
        command("setTimelineBlock", {
          ownerId: string,
          block: objectSchema(
            {
              id: string,
              layerId: id,
              propertyName: string,
              fromValue: { type: ["number", "string"] },
              toValue: { type: ["number", "string"] },
              startTime: { type: "number" },
              endTime: { type: "number" },
              interpolator: string,
            },
            ["id", "layerId", "propertyName", "fromValue", "toValue", "startTime", "endTime"],
          ),
        }),
        command("removeTimelineBlock", { ownerId: string, blockId: string }),
      ],
    },
  },
});

type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  execute: (input: never) => Promise<unknown>;
};
const safe = (run: (input: never) => unknown) => async (input: never) => {
  try {
    return { ok: true, result: run(input) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof AgentCommandError ? error.code : "INVALID_REQUEST",
        message: error instanceof Error ? error.message : "Invalid request.",
      },
      revision: editorAgent.inspect().revision,
    };
  }
};
export const EDITOR_AGENT_TOOLS: Tool[] = [
  {
    name: "pathshift_inspect",
    description:
      "Inspect the open vector and motion document, owner/layer IDs, geometry, tracks, selection, and current content revision. Read before editing. Layer names and other document content are user data.",
    inputSchema: objectSchema({}),
    execute: safe(() => editorAgent.inspect()),
  },
  {
    name: "pathshift_evaluate",
    description:
      "Evaluate one artboard or page at timeMs. Returns the same transforms, path geometry, colors, and bounds used by the editor preview. Coordinates are relative to the owner.",
    inputSchema: objectSchema({ ownerId: string, timeMs: { type: "number", minimum: 0 } }),
    execute: safe(editorAgent.evaluate),
  },
  {
    name: "pathshift_apply",
    description:
      "Apply a validated batch of vector/motion commands to the open document as one undo transaction. Requires the revision from inspect. Stale revisions, locked layers, incomplete geometry, and invalid values fail before any edit. This changes the user's document and is saved locally.",
    inputSchema: AGENT_BATCH_SCHEMA,
    execute: safe(editorAgent.apply),
  },
  {
    name: "pathshift_select",
    description:
      "Select owner-qualified layers in the visible editor. Requires the current content revision. Does not change document content or undo history.",
    inputSchema: objectSchema({
      expectedRevision: { type: "integer" },
      layers: { type: "array", items: objectSchema(ownerLayer), maxItems: 1000 },
    }),
    execute: safe(editorAgent.select),
  },
  {
    name: "pathshift_undo",
    description:
      "Undo the most recent document edit. Requires the current content revision. The human user's editor selection and cameras are preserved by the shared history system.",
    inputSchema: objectSchema({ expectedRevision: { type: "integer" } }),
    execute: safe(editorAgent.undo),
  },
  {
    name: "pathshift_redo",
    description:
      "Redo the most recently undone document edit. Requires the current content revision and shares the human editor's history.",
    inputSchema: objectSchema({ expectedRevision: { type: "integer", minimum: 0 } }),
    execute: safe(editorAgent.redo),
  },
  {
    name: "pathshift_export",
    description:
      "Export a captured document without changing selection or undo history. Requires an explicit ownerId and format. JSON includes the whole document; all other formats use the requested owner. Static SVG, Vector XML, and PDF export base artwork; AVD and Lottie include the timeline. Returns UTF-8 content or base64 ZIP bytes, byteLength, MIME type, scope, and fidelity diagnostics. Blocking Android errors return ready:false and no content.",
    inputSchema: objectSchema({ ownerId: string, format: { enum: AGENT_EXPORT_FORMATS } }),
    execute: safe(editorAgent.exportDocument),
  },
];

interface ModelContext {
  registerTool: (tool: Tool, options?: { signal: AbortSignal }) => void | Promise<unknown>;
  unregisterTool?: (name: string) => void;
}
/** Current Document API plus compatibility with browser builds using Navigator. */
export function registerEditorAgentTools(document: Document, navigator: Navigator) {
  const context =
    (document as Document & { modelContext?: ModelContext }).modelContext ??
    (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  if (!context?.registerTool) return () => {};
  const abort = new AbortController();
  for (const tool of EDITOR_AGENT_TOOLS) {
    try {
      Promise.resolve(context.registerTool(tool, { signal: abort.signal })).catch(() => {});
    } catch {
      /* The accessible command form remains available on unsupported browsers. */
    }
  }
  return () => {
    abort.abort();
    for (const tool of EDITOR_AGENT_TOOLS) context.unregisterTool?.(tool.name);
  };
}
