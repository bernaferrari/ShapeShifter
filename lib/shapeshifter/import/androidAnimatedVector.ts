import { generateId } from "../ids";
import { androidToCssHexColor } from "../mathUtils";
import { parsePath, pathToString } from "../pathUtils";
import type { AnimationState, Layer, TimelineBlock } from "../types";
import { importVectorDrawable, type VectorDrawableImportResult } from "./androidVectorDrawable";

export interface AndroidBundleFile {
  path: string;
  content: string;
}

/**
 * A non-blocking warning about Android animation semantics the editable
 * timeline cannot retain exactly. Import still preserves the vector and every
 * supported ObjectAnimator so people can recover useful work, but it must not
 * imply an exact round trip when Android timing differs.
 */
export interface AndroidImportDiagnostic {
  severity: "warning";
  code: string;
  message: string;
  targetName?: string;
  resourceName?: string;
}

export interface AnimatedVectorImportResult extends VectorDrawableImportResult {
  animation: AnimationState;
  diagnostics: AndroidImportDiagnostic[];
}

function localName(el: Element): string {
  return el.tagName.toLowerCase().replace(/.*:/, "");
}

function androidAttr(el: Element, name: string, fallback = ""): string {
  return el.getAttribute(`android:${name}`) ?? el.getAttribute(name) ?? fallback;
}

function resourceKey(value: string): string {
  return value.replace(/^@(drawable|animator|interpolator)\//, "").replace(/^.*\//, "");
}

function indexFiles(files: AndroidBundleFile[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of files) {
    const base = file.path.split("/").at(-1) ?? file.path;
    const stem = base.replace(/\.xml$/i, "");
    index.set(stem, file.content);
    index.set(base, file.content);
    index.set(file.path.replace(/^\/+/, ""), file.content);
  }
  return index;
}

interface ResolvedInterpolator {
  value: string;
  warning?: string;
}

function namedInterpolator(value: string, files: Map<string, string>): ResolvedInterpolator {
  const normalized = value.trim();
  // ObjectAnimator uses AccelerateDecelerateInterpolator when no explicit
  // interpolator is supplied. Persist the name so imported previews and a
  // subsequent export retain Android's actual default rather than relying on
  // an implicit editor fallback.
  if (!normalized) return { value: "ACCELERATE_DECELERATE" };
  if (normalized.includes("fast_out_slow_in")) return { value: "FAST_OUT_SLOW_IN" };
  if (normalized.includes("fast_out_linear_in")) return { value: "FAST_OUT_LINEAR_IN" };
  if (normalized.includes("linear_out_slow_in")) return { value: "LINEAR_OUT_SLOW_IN" };
  if (normalized.includes("accelerate_decelerate")) return { value: "ACCELERATE_DECELERATE" };
  if (
    normalized === "linear" ||
    normalized.includes("linear_interpolator") ||
    normalized.endsWith("/linear")
  ) {
    return { value: "LINEAR" };
  }
  const interpolatorXml = files.get(resourceKey(normalized));
  if (!interpolatorXml) {
    return {
      value: normalized,
      warning: `Interpolator ${normalized} could not be resolved; preview falls back to linear easing.`,
    };
  }
  const doc = new DOMParser().parseFromString(interpolatorXml, "application/xml");
  if (doc.querySelector("parsererror")) {
    return {
      value: normalized,
      warning: `Interpolator ${normalized} is malformed; preview falls back to linear easing.`,
    };
  }
  const root = doc.documentElement;
  const rootName = localName(root);
  if (rootName === "linearinterpolator") return { value: "LINEAR" };
  if (rootName === "acceleratedecelerateinterpolator") {
    return { value: "ACCELERATE_DECELERATE" };
  }
  const x1 = androidAttr(root, "controlX1");
  const y1 = androidAttr(root, "controlY1");
  const x2 = androidAttr(root, "controlX2");
  const y2 = androidAttr(root, "controlY2");
  if (x1 && y1 && x2 && y2) {
    return { value: `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})` };
  }
  return {
    value: normalized,
    warning: `Interpolator ${normalized} cannot be represented by the editor timeline; preview falls back to linear easing.`,
  };
}

function animatorValue(raw: string, propertyName: string): string | number {
  if (propertyName === "pathData") return raw;
  if (propertyName === "fillColor" || propertyName === "strokeColor") {
    return raw.startsWith("#") ? androidToCssHexColor(raw) || raw : raw;
  }
  const number = Number(raw);
  return Number.isFinite(number) ? number : raw;
}

const DEFAULT_PROPERTY_VALUES: Record<string, number> = {
  alpha: 1,
  fillAlpha: 1,
  strokeAlpha: 1,
  strokeWidth: 0,
  trimPathStart: 0,
  trimPathEnd: 1,
  trimPathOffset: 0,
  rotation: 0,
  pivotX: 0,
  pivotY: 0,
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0,
};

/**
 * Android permits ObjectAnimator to omit valueFrom. In that form it starts at
 * the target property's current drawable value, so importing it as an empty
 * string changes the animation before the first frame. Keep this deliberately
 * limited to the VectorDrawable properties the editor already models.
 */
function targetPropertyValue(layer: Layer, propertyName: string): string | number {
  if (propertyName === "pathData") return pathToString(layer.pathData ?? layer.from);

  const raw = (layer as unknown as Record<string, unknown>)[propertyName];
  if (propertyName === "fillColor" || propertyName === "strokeColor") {
    return typeof raw === "string" && raw.trim() ? raw : "#00000000";
  }
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const numeric = Number(raw);
    if (raw.trim() && Number.isFinite(numeric)) return numeric;
  }
  return DEFAULT_PROPERTY_VALUES[propertyName] ?? 0;
}

interface AnimatorImportContext {
  targetName: string;
  resourceName: string;
}

function addDiagnostic(
  diagnostics: AndroidImportDiagnostic[],
  context: AnimatorImportContext,
  code: string,
  message: string,
) {
  const diagnostic: AndroidImportDiagnostic = {
    severity: "warning",
    code,
    message,
    targetName: context.targetName,
    resourceName: context.resourceName,
  };
  if (
    !diagnostics.some(
      (existing) =>
        existing.code === diagnostic.code &&
        existing.message === diagnostic.message &&
        existing.targetName === diagnostic.targetName &&
        existing.resourceName === diagnostic.resourceName,
    )
  ) {
    diagnostics.push(diagnostic);
  }
}

function hasMeaningfulRepeat(el: Element): boolean {
  const raw = androidAttr(el, "repeatCount").trim();
  return Boolean(raw) && raw !== "0";
}

/**
 * The editor has a flat timeline. A plain parallel AnimatorSet is equivalent
 * to independent blocks, but serial or nested sets can add inherited timing
 * that the current model cannot encode. Flag every such source construct
 * before the legacy flat parser reads the ObjectAnimators beneath it.
 */
function inspectAnimatorTimingSemantics(
  root: Element,
  files: Map<string, string>,
  context: AnimatorImportContext,
  diagnostics: AndroidImportDiagnostic[],
) {
  const elements = [root, ...Array.from(root.getElementsByTagName("*"))];
  const sets = elements.filter((el) => localName(el) === "set");

  for (const set of sets) {
    const ordering = androidAttr(set, "ordering", "together").trim().toLowerCase();
    if (ordering && ordering !== "together") {
      addDiagnostic(
        diagnostics,
        context,
        "ANIMATOR_SET_SEQUENTIAL_TIMING",
        `${context.resourceName} uses AnimatorSet ordering="${ordering}"; child tracks were imported without sequential timing offsets.`,
      );
    }
    if (Array.from(set.children).some((child) => localName(child) === "set")) {
      addDiagnostic(
        diagnostics,
        context,
        "NESTED_ANIMATOR_SET",
        `${context.resourceName} contains a nested AnimatorSet; inherited set timing cannot be represented by the flat editor timeline.`,
      );
    }

    const unsupportedSetTiming = [
      "duration",
      "startOffset",
      "startDelay",
      "repeatCount",
      "repeatMode",
      "interpolator",
    ].filter((name) => androidAttr(set, name).trim());
    if (unsupportedSetTiming.length) {
      addDiagnostic(
        diagnostics,
        context,
        "ANIMATOR_SET_TIMING_UNSUPPORTED",
        `${context.resourceName} applies ${unsupportedSetTiming.join(", ")} to an AnimatorSet; those inherited timing values were not imported.`,
      );
    }
  }

  for (const animator of elements) {
    const tag = localName(animator);
    if (tag === "animator") {
      addDiagnostic(
        diagnostics,
        context,
        "UNSUPPORTED_VALUE_ANIMATOR",
        `${context.resourceName} contains a ValueAnimator without a target property; it was not imported into the editable timeline.`,
      );
      continue;
    }
    if (tag !== "objectanimator") continue;

    const propertyName = androidAttr(animator, "propertyName", "this animator");
    if (hasMeaningfulRepeat(animator)) {
      addDiagnostic(
        diagnostics,
        context,
        "ANIMATOR_REPEAT_UNSUPPORTED",
        `${context.resourceName}'s ${propertyName} animation repeats on Android; only its first pass was imported.`,
      );
    }
    if (androidAttr(animator, "startDelay").trim()) {
      addDiagnostic(
        diagnostics,
        context,
        "ANIMATOR_START_DELAY_UNSUPPORTED",
        `${context.resourceName}'s ${propertyName} animation uses startDelay; only Android startOffset is imported.`,
      );
    }
    if (!androidAttr(animator, "valueTo").trim()) {
      addDiagnostic(
        diagnostics,
        context,
        "ANIMATOR_VALUE_TO_MISSING",
        `${context.resourceName}'s ${propertyName} animation omits valueTo; the target's current property value was imported as the end value.`,
      );
    }
    if (
      Array.from(animator.children).some((child) => localName(child) === "propertyvaluesholder")
    ) {
      addDiagnostic(
        diagnostics,
        context,
        "PROPERTY_VALUES_HOLDER_UNSUPPORTED",
        `${context.resourceName}'s ${propertyName} animation uses propertyValuesHolder/keyframes; only top-level valueFrom/valueTo were imported.`,
      );
    }

    const interpolator = namedInterpolator(androidAttr(animator, "interpolator"), files);
    if (interpolator.warning) {
      addDiagnostic(diagnostics, context, "INTERPOLATOR_UNSUPPORTED", interpolator.warning);
    }
  }
}

function parseObjectAnimators(
  xml: string,
  files: Map<string, string>,
  layer: Layer,
  context: AnimatorImportContext,
  diagnostics: AndroidImportDiagnostic[],
): TimelineBlock[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    addDiagnostic(
      diagnostics,
      context,
      "MALFORMED_ANIMATOR_RESOURCE",
      `${context.resourceName} could not be parsed, so its animation was not imported.`,
    );
    return [];
  }
  inspectAnimatorTimingSemantics(doc.documentElement, files, context, diagnostics);
  const blocks: TimelineBlock[] = [];
  for (const el of Array.from(doc.getElementsByTagName("*"))) {
    if (localName(el) !== "objectanimator") continue;
    const propertyName = androidAttr(el, "propertyName");
    if (!propertyName) continue;
    const start = Number(androidAttr(el, "startOffset", "0"));
    const durationText = androidAttr(el, "duration");
    const duration = durationText.trim() ? Number(durationText) : 300;
    const resolvedDuration = Number.isFinite(duration) && duration >= 0 ? duration : 300;
    const valueFrom = androidAttr(el, "valueFrom");
    const interpolator = namedInterpolator(androidAttr(el, "interpolator"), files);
    blocks.push({
      id: generateId(),
      layerId: "",
      propertyName,
      fromValue: valueFrom.trim()
        ? animatorValue(valueFrom, propertyName)
        : targetPropertyValue(layer, propertyName),
      toValue: androidAttr(el, "valueTo").trim()
        ? animatorValue(androidAttr(el, "valueTo"), propertyName)
        : targetPropertyValue(layer, propertyName),
      startTime: Number.isFinite(start) ? start : 0,
      endTime: (Number.isFinite(start) ? start : 0) + Math.max(1, resolvedDuration),
      interpolator: interpolator.value,
      type:
        propertyName === "pathData"
          ? "path"
          : propertyName === "fillColor" || propertyName === "strokeColor"
            ? "color"
            : "number",
    });
  }
  return blocks;
}

function findLayer(layers: Layer[], targetName: string): Layer | undefined {
  const bare = targetName.replace(/_transform$/, "");
  return (
    layers.find((layer) => layer.androidName === targetName) ??
    layers.find((layer) => layer.androidName === bare) ??
    layers.find((layer) => layer.name === targetName) ??
    layers.find((layer) => layer.name === bare)
  );
}

export function importAnimatedVectorBundle(files: AndroidBundleFile[]): AnimatedVectorImportResult {
  const index = indexFiles(files);
  const avdFile =
    files.find((file) => file.content.includes("<animated-vector")) ??
    files.find((file) => /_animated\.xml$/i.test(file.path));
  if (!avdFile) {
    const vectorOnly = files.find((file) => file.content.includes("<vector"));
    if (!vectorOnly) throw new Error("No VectorDrawable or AnimatedVectorDrawable found");
    const imported = importVectorDrawable(vectorOnly.content);
    return {
      ...imported,
      animation: { id: "motion", name: "Motion", duration: 1000, blocks: [] },
      diagnostics: [],
    };
  }

  const avd = new DOMParser().parseFromString(avdFile.content, "application/xml");
  const root = avd.documentElement;
  const drawableRef = androidAttr(root, "drawable");
  const vectorXml =
    index.get(resourceKey(drawableRef)) ??
    files.find((file) => file.content.includes("<vector"))?.content;
  if (!vectorXml) throw new Error("Animated vector is missing its VectorDrawable");
  const imported = importVectorDrawable(vectorXml);
  const blocks: TimelineBlock[] = [];
  const diagnostics: AndroidImportDiagnostic[] = [];
  for (const target of Array.from(root.getElementsByTagName("*"))) {
    if (localName(target) !== "target") continue;
    const name = androidAttr(target, "name");
    const animationRef = androidAttr(target, "animation");
    const animatorXml = index.get(resourceKey(animationRef));
    if (!name || !animationRef) {
      diagnostics.push({
        severity: "warning",
        code: "MALFORMED_AVD_TARGET",
        message: "An AVD target is missing android:name or android:animation and was skipped.",
        targetName: name || undefined,
        resourceName: animationRef || undefined,
      });
      continue;
    }
    if (!animatorXml) {
      diagnostics.push({
        severity: "warning",
        code: "UNRESOLVED_ANIMATOR_RESOURCE",
        message: `AVD target ${name} references ${animationRef}, which was not included in this import.`,
        targetName: name,
        resourceName: animationRef,
      });
      continue;
    }
    const layer = findLayer(imported.layers, name);
    if (!layer) {
      diagnostics.push({
        severity: "warning",
        code: "ANIMATION_TARGET_NOT_FOUND",
        message: `AVD target ${name} does not match a layer in the imported VectorDrawable.`,
        targetName: name,
        resourceName: animationRef,
      });
      continue;
    }
    const context = { targetName: name, resourceName: animationRef };
    for (const block of parseObjectAnimators(animatorXml, index, layer, context, diagnostics)) {
      const next: TimelineBlock = { ...block, layerId: layer.id };
      blocks.push(next);
      if (next.propertyName === "pathData" && typeof next.toValue === "string") {
        layer.to = parsePath(next.toValue);
        if (typeof next.fromValue === "string") {
          layer.from = parsePath(next.fromValue);
          layer.pathData = layer.from;
        }
      }
    }
  }
  // A malformed/empty AVD has no observable duration, so retain the previous
  // editor fallback in that case. Real animator timing, including short clips,
  // must remain exact instead of being expanded to one second.
  const duration = Math.max(...blocks.map((block) => block.endTime), blocks.length ? 0 : 1000);
  return {
    ...imported,
    animation: { id: "imported-avd", name: "Imported AVD", duration, blocks },
    diagnostics,
  };
}

export function isAnimatedVectorMarkup(text: string): boolean {
  return text.includes("<animated-vector");
}
