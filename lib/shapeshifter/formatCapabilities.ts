/**
 * Per-format capability profiles for ANIMATION TRACKS in each export target.
 *
 * Semantics: these capabilities describe what the EXPORT TARGET can represent,
 * never what the editor lets you author. Editing is never restricted; tracks a
 * format cannot represent are surfaced as annotations/diagnostics at export
 * time instead of being blocked during authoring.
 */

export type ExportFormatId = "vector" | "avd" | "svg" | "lottie" | "pdf";

export type TrackCapability =
  | "pathData"
  | "color"
  | "alpha"
  | "trimPath"
  | "translation"
  | "rotation"
  | "scale"
  | "pathMorph"
  | "customEasing";

export interface FormatCapability {
  supported: boolean;
  note?: string;
}

export interface FormatProfile {
  id: ExportFormatId;
  label: string;
  capabilities: Record<TrackCapability, FormatCapability>;
  notes: string[];
}

const TRACK_CAPABILITIES: TrackCapability[] = [
  "pathData",
  "color",
  "alpha",
  "trimPath",
  "translation",
  "rotation",
  "scale",
  "pathMorph",
  "customEasing",
];

const STATIC_NOTES = [
  "Static target: exports the artwork at its current state without animation tracks.",
];

function staticProfile(id: ExportFormatId, label: string, notes: string[]): FormatProfile {
  const capabilities = {} as Record<TrackCapability, FormatCapability>;
  for (const capability of TRACK_CAPABILITIES) {
    capabilities[capability] = {
      supported: false,
      note: "Static format: animation tracks cannot be represented.",
    };
  }
  return { id, label, capabilities, notes };
}

const vectorProfile = staticProfile("vector", "VectorDrawable XML", STATIC_NOTES);

const pdfProfile = staticProfile("pdf", "PDF document", STATIC_NOTES);

const TRIM_PATH_AVD_NOTE =
  "AnimatedVectorDrawable has no trim path animator, so animated trim tracks cannot be represented.";

const avdProfile: FormatProfile = {
  id: "avd",
  label: "AnimatedVectorDrawable",
  notes: [
    "Tracks animate through <objectAnimator> targets on the VectorDrawable.",
    "Path morphs require morph-compatible command sequences (see Prepare for morph).",
  ],
  capabilities: {
    pathData: {
      supported: true,
      note: "Animated via propertyValueAnimator on android:pathData.",
    },
    color: { supported: true },
    alpha: { supported: true },
    trimPath: { supported: false, note: TRIM_PATH_AVD_NOTE },
    translation: { supported: true },
    rotation: { supported: true },
    scale: { supported: true },
    pathMorph: { supported: true },
    customEasing: {
      supported: true,
      note: "Custom cubic beziers are emitted as pathInterpolator resources.",
    },
  },
};

const svgProfile: FormatProfile = {
  id: "svg",
  label: "Animated SVG",
  notes: [
    "Exports a self-contained SVG whose embedded script swaps pre-baked path frames — it morphs one layer's from→to shapes.",
    "No SMIL <animate> is emitted, and only the selected layer's path morph is baked; other animated tracks are not represented.",
  ],
  capabilities: {
    pathData: {
      supported: false,
      note: "Only the from→to morph is baked into frame samples; arbitrary path-data keyframe tracks are not emitted.",
    },
    color: {
      supported: false,
      note: "The baked SVG animates geometry only; fill/stroke color tracks are not represented.",
    },
    alpha: {
      supported: false,
      note: "The baked SVG animates geometry only; alpha tracks are not represented.",
    },
    trimPath: {
      supported: false,
      note: "Trim segments cannot be represented by the baked frame swap; dash-array workarounds are not emitted.",
    },
    translation: {
      supported: false,
      note: "The baked SVG morphs path data in place; translation tracks are not represented.",
    },
    rotation: {
      supported: false,
      note: "The baked SVG morphs path data in place; rotation tracks are not represented.",
    },
    scale: {
      supported: false,
      note: "The baked SVG morphs path data in place; scale tracks are not represented.",
    },
    pathMorph: { supported: true },
    customEasing: {
      supported: false,
      note: "Playback easing is hardcoded to fast-out-slow-in; per-track cubic beziers are not emitted.",
    },
  },
};

const lottieProfile: FormatProfile = {
  id: "lottie",
  label: "Lottie JSON",
  notes: ["Tracks map onto Lottie shape-layer transform and shape properties."],
  capabilities: {
    pathData: { supported: true },
    color: { supported: true },
    alpha: { supported: true },
    trimPath: {
      supported: false,
      note: "Lottie does have a native trim path (a:trimPath), but this exporter does not emit it yet, so trim tracks are dropped.",
    },
    translation: { supported: true },
    rotation: { supported: true },
    scale: { supported: true },
    pathMorph: { supported: true },
    customEasing: { supported: true },
  },
};

export const CAPABILITY_MATRIX: Record<ExportFormatId, FormatProfile> = {
  vector: vectorProfile,
  avd: avdProfile,
  svg: svgProfile,
  lottie: lottieProfile,
  pdf: pdfProfile,
};

export function capabilityFor(
  format: ExportFormatId,
  trackCapability: TrackCapability,
): FormatCapability {
  return CAPABILITY_MATRIX[format].capabilities[trackCapability];
}

export function formatSupports(format: ExportFormatId, trackCapability: TrackCapability): boolean {
  return capabilityFor(format, trackCapability).supported;
}
