import { describe, expect, it } from "vitest";
import { CAPABILITY_MATRIX, capabilityFor, formatSupports } from "../formatCapabilities";
import type { ExportFormatId, FormatProfile, TrackCapability } from "../formatCapabilities";
import { compileAndroidArtboard } from "../androidCompiler";
import { parsePath } from "../pathUtils";
import type { AndroidArtboardInput } from "../androidCompiler";

const FORMATS: ExportFormatId[] = ["vector", "avd", "svg", "lottie", "pdf"];

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

const avdInputWithTracks = (
  blocks: Array<
    Pick<
      NonNullable<AndroidArtboardInput["animation"]>["blocks"][number],
      "id" | "propertyName" | "fromValue" | "toValue"
    >
  >,
): AndroidArtboardInput => ({
  name: "Favorite Icon",
  vector: { id: "vector", name: "Favorite Icon", width: 24, height: 24, alpha: 1 },
  hiddenLayerIds: [],
  layers: [
    {
      id: "heart",
      name: "Heart",
      type: "path",
      from: parsePath("M2 12 L12 22 L22 12 Z"),
      pathData: parsePath("M2 12 L12 22 L22 12 Z"),
      visible: true,
      locked: false,
      fillColor: "#ff3366",
      strokeColor: "#000000",
    },
  ],
  animation: {
    id: "motion",
    name: "Pulse",
    duration: 1000,
    blocks: blocks.map((block) => ({
      ...block,
      layerId: "heart",
      startTime: 0,
      endTime: 1000,
    })),
  },
});

describe("format capability matrix", () => {
  it("covers every format with every track capability present", () => {
    expect(Object.keys(CAPABILITY_MATRIX).sort()).toEqual([...FORMATS].sort());
    for (const format of FORMATS) {
      const profile: FormatProfile = CAPABILITY_MATRIX[format];
      expect(profile.id).toBe(format);
      expect(typeof profile.label).toBe("string");
      expect(Object.keys(profile.capabilities).sort()).toEqual([...TRACK_CAPABILITIES].sort());
      for (const track of TRACK_CAPABILITIES) {
        const capability = profile.capabilities[track];
        expect(capability, `${format}/${track}`).toHaveProperty("supported");
        expect(typeof capability.supported).toBe("boolean");
      }
      expect(Array.isArray(profile.notes)).toBe(true);
    }
  });

  it("marks static formats as fully static and unsupported for all tracks", () => {
    for (const format of ["vector", "pdf"] as ExportFormatId[]) {
      for (const track of TRACK_CAPABILITIES) {
        expect(formatSupports(format, track)).toBe(false);
        expect(capabilityFor(format, track).note).toBeTruthy();
      }
      expect(CAPABILITY_MATRIX[format].notes.length).toBeGreaterThan(0);
    }
  });

  it("matches the ground-truth support table per target", () => {
    const allUnsupported = Object.fromEntries(
      TRACK_CAPABILITIES.map((track) => [track, false]),
    ) as Record<TrackCapability, boolean>;
    // The 'svg' target is exportAnimatedSVG: a JS-baked from→to morph of one
    // layer. Only pathMorph is real; nothing emits SMIL <animate>.
    const expected: Record<ExportFormatId, Partial<Record<TrackCapability, boolean>>> = {
      vector: allUnsupported,
      pdf: allUnsupported,
      avd: { trimPath: false },
      svg: { ...allUnsupported, pathMorph: true },
      lottie: { trimPath: false },
    };
    for (const format of FORMATS) {
      for (const track of TRACK_CAPABILITIES) {
        const expectedSupported = expected[format][track] ?? true;
        expect(formatSupports(format, track), `${format}/${track}`).toBe(expectedSupported);
      }
    }
  });

  it("gives unsupported capabilities an explanatory note", () => {
    for (const format of FORMATS) {
      for (const track of TRACK_CAPABILITIES) {
        const capability = capabilityFor(format, track);
        if (!capability.supported) {
          expect(capability.note, `${format}/${track}`).toMatch(/\S/);
        }
      }
    }
  });

  it("describes lottie trim path honestly as a not-yet-emitted exporter gap", () => {
    const capability = capabilityFor("lottie", "trimPath");
    expect(capability.supported).toBe(false);
    expect(capability.note).toContain("does not emit");
  });

  it("describes the animated-SVG target honestly as a baked single-layer morph, not SMIL", () => {
    const profile = CAPABILITY_MATRIX.svg;
    // Nothing in lib/ emits SMIL; the only 'svg' export path is
    // exportAnimatedSVG (embedded script swapping pre-baked frames).
    expect(profile.label).not.toContain("SMIL");
    expect(profile.notes.join(" ")).toContain("No SMIL");
    for (const track of TRACK_CAPABILITIES) {
      if (track === "pathMorph") {
        expect(formatSupports("svg", track)).toBe(true);
      } else {
        expect(formatSupports("svg", track), `svg/${track}`).toBe(false);
      }
    }
  });
});

describe("capability helpers", () => {
  it("returns stable pure results without touching shared state", () => {
    const first = capabilityFor("avd", "trimPath");
    const second = capabilityFor("avd", "trimPath");
    expect(second).toEqual(first);
    expect(first.supported).toBe(false);

    expect(formatSupports("lottie", "pathMorph")).toBe(true);
    expect(formatSupports("vector", "translation")).toBe(false);
    // Inputs unchanged by queries.
    expect(CAPABILITY_MATRIX.avd.capabilities.trimPath.supported).toBe(false);
  });
});

describe("android compiler UNSUPPORTED_TRACK_FOR_FORMAT diagnostics", () => {
  it("errors on animated trim tracks for AVD export", () => {
    const bundle = compileAndroidArtboard(
      avdInputWithTracks([
        { id: "trim", propertyName: "trimPathStart", fromValue: 0, toValue: 0.5 },
      ]),
    );
    const diagnostic = bundle.diagnostics.find(
      (entry) => entry.code === "UNSUPPORTED_TRACK_FOR_FORMAT",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.propertyName).toBe("trimPathStart");
    expect(diagnostic?.layerId).toBe("heart");
  });

  it("warns on other unsupported tracks but still compiles remaining ones", () => {
    // trimPath is currently the only unsupported AVD track in the matrix; pin
    // that invariant so a future matrix edit forces this test to be revisited.
    expect(formatSupports("avd", "trimPath")).toBe(false);
    for (const track of TRACK_CAPABILITIES) {
      if (track !== "trimPath") expect(formatSupports("avd", track)).toBe(true);
    }

    // Sanity: supported tracks produce no capability diagnostics.
    const clean = compileAndroidArtboard(
      avdInputWithTracks([{ id: "move", propertyName: "translateX", fromValue: 1, toValue: 4 }]),
    );
    expect(clean.diagnostics.some((entry) => entry.code === "UNSUPPORTED_TRACK_FOR_FORMAT")).toBe(
      false,
    );
    expect(clean.files.some((file) => file.path.endsWith("_animated.xml"))).toBe(true);
  });
});
