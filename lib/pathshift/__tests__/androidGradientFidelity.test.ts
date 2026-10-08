// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { compileAndroidArtboard } from "../androidCompiler";
import { exportVectorDrawable } from "../exporter";
import { gradientToSvg } from "../gradients";
import { importVectorDrawable } from "../import/androidVectorDrawable";

const animation = { id: "none", name: "none", duration: 1, blocks: [] };

describe("Android gradient coordinate fidelity", () => {
  it("keeps a partial path's viewport-space linear endpoints through preview and Android round trips", () => {
    const source = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:aapt="http://schemas.android.com/aapt"
      android:width="24dp"
      android:height="24dp"
      android:viewportWidth="100"
      android:viewportHeight="80">
      <path android:name="partial" android:pathData="M20,20 L60,20 L60,60 L20,60 Z">
        <aapt:attr name="android:fillColor">
          <gradient android:type="linear" android:startX="12.5" android:startY="7.25" android:endX="83.75" android:endY="70.5">
            <item android:offset="0" android:color="#ffff0000" />
            <item android:offset="1" android:color="#ff0000ff" />
          </gradient>
        </aapt:attr>
      </path>
    </vector>`;

    const imported = importVectorDrawable(source);
    const layer = imported.layers[0]!;
    const gradient = layer.fillGradient!;

    expect(gradient).toMatchObject({
      type: "linear",
      coordinateSpace: "userSpace",
      x1: 12.5,
      y1: 7.25,
      x2: 83.75,
      y2: 70.5,
    });

    // All SVG-driven previews call this same renderer. userSpaceOnUse makes the
    // imported endpoints resolve in the artboard's Android viewport coordinates,
    // rather than against this path's smaller 20..60 bounding box.
    const preview = gradientToSvg(gradient, "preview-gradient");
    expect(preview).toContain('gradientUnits="userSpaceOnUse"');
    expect(preview).toContain('x1="12.5"');
    expect(preview).toContain('y1="7.25"');
    expect(preview).toContain('x2="83.75"');
    expect(preview).toContain('y2="70.5"');

    const bundle = compileAndroidArtboard({
      name: "Partial gradient",
      layers: imported.layers,
      vector: {
        id: "vector",
        name: "Partial gradient",
        width: imported.width,
        height: imported.height,
        viewportWidth: imported.viewportWidth,
        viewportHeight: imported.viewportHeight,
        alpha: imported.alpha,
      },
      animation,
    });
    const xml = bundle.files.find((file) => file.path.endsWith("_vector.xml"))!.content;
    expect(xml).toContain('android:startX="12.5"');
    expect(xml).toContain('android:startY="7.25"');
    expect(xml).toContain('android:endX="83.75"');
    expect(xml).toContain('android:endY="70.5"');

    const reimported = importVectorDrawable(xml).layers[0]!.fillGradient!;
    expect(reimported).toMatchObject({
      coordinateSpace: "userSpace",
      x1: 12.5,
      y1: 7.25,
      x2: 83.75,
      y2: 70.5,
    });

    // The legacy one-layer Android path uses the same model semantics too.
    const legacy = exportVectorDrawable(layer, {
      width: 24,
      height: 24,
      viewBoxWidth: 100,
      viewBoxHeight: 80,
    });
    expect(legacy).toContain('android:startX="12.5"');
    expect(legacy).toContain('android:endX="83.75"');
  });

  it("retains Android radial center and radius as viewport-space values", () => {
    const source = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:aapt="http://schemas.android.com/aapt"
      android:width="24dp"
      android:height="24dp"
      android:viewportWidth="100"
      android:viewportHeight="80">
      <path android:name="partial" android:pathData="M20,20 L60,20 L60,60 L20,60 Z">
        <aapt:attr name="android:fillColor">
          <gradient android:type="radial" android:centerX="71" android:centerY="13" android:gradientRadius="31.5">
            <item android:offset="0" android:color="#ffff0000" />
            <item android:offset="1" android:color="#ff0000ff" />
          </gradient>
        </aapt:attr>
      </path>
    </vector>`;

    const imported = importVectorDrawable(source);
    const gradient = imported.layers[0]!.fillGradient!;
    expect(gradient).toMatchObject({
      type: "radial",
      coordinateSpace: "userSpace",
      cx: 71,
      cy: 13,
      r: 31.5,
    });
    const preview = gradientToSvg(gradient, "preview-radial");
    expect(preview).toContain('gradientUnits="userSpaceOnUse"');
    expect(preview).toContain('cx="71"');
    expect(preview).toContain('cy="13"');
    expect(preview).toContain('r="31.5"');

    const bundle = compileAndroidArtboard({
      name: "Radial gradient",
      layers: imported.layers,
      vector: {
        id: "vector",
        name: "Radial gradient",
        width: imported.width,
        height: imported.height,
        viewportWidth: imported.viewportWidth,
        viewportHeight: imported.viewportHeight,
        alpha: imported.alpha,
      },
      animation,
    });
    const xml = bundle.files.find((file) => file.path.endsWith("_vector.xml"))!.content;
    expect(xml).toContain('android:centerX="71"');
    expect(xml).toContain('android:centerY="13"');
    expect(xml).toContain('android:gradientRadius="31.5"');
  });
});
