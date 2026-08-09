import { linearVector, normalizeStops } from "../gradients";
import { pathToString } from "../pathUtils";
import type { Layer } from "../types";
import type { ExportOptions } from "./types";

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const safeName = (value: string) => value.replace(/[^\w.]+/g, "_").replace(/^(\d)/, "_$1");

/**
 * Build an Android `<aapt:attr name="android:fillColor"><gradient .../></aapt:attr>`
 * block. Android gradients live in viewport space, so we map the unit-box vector
 * across the full viewport (a faithful approximation; objectBoundingBox isn't
 * available in VD). Stop opacity is folded into 8-digit #AARRGGBB colors.
 */
function vectorDrawableGradient(layer: Layer, vw: number, vh: number): string {
  const g = layer.fillGradient!;
  const fillAlpha = layer.fillAlpha ?? 1;
  const items = normalizeStops(g.stops)
    .map(
      (s) =>
        `          <item android:offset="${Number(s.offset.toFixed(4))}" android:color="${toAndroidColor(
          s.color,
          (s.opacity ?? 1) * fillAlpha,
        )}" />`,
    )
    .join("\n");

  let attrs: string;
  if (g.type === "radial") {
    const cx = (g.cx ?? 0.5) * vw;
    const cy = (g.cy ?? 0.5) * vh;
    const gr = (g.r ?? 0.5) * Math.max(vw, vh);
    attrs = `android:type="radial" android:centerX="${num(cx)}" android:centerY="${num(
      cy,
    )}" android:gradientRadius="${num(gr)}"`;
  } else {
    const v = linearVector(g.angle ?? 0);
    attrs = `android:type="linear" android:startX="${num(v.x1 * vw)}" android:startY="${num(
      v.y1 * vh,
    )}" android:endX="${num(v.x2 * vw)}" android:endY="${num(v.y2 * vh)}"`;
  }

  return `
      <aapt:attr name="android:fillColor">
        <gradient ${attrs}>
${items}
        </gradient>
      </aapt:attr>`;
}

const num = (n: number) => Number(n.toFixed(3)).toString();

/** #RRGGBB (+ alpha) → Android #AARRGGBB. */
function toAndroidColor(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(hex);
  if (!m) return "#FF000000";
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${a}${h.slice(0, 6)}`.toUpperCase();
}

export function exportVectorDrawable(layer: Layer, options: ExportOptions = {}) {
  const { width = 48, height = 48, viewBoxWidth = 48, viewBoxHeight = 48 } = options;
  const d = pathToString(layer.pathData ?? layer.from); // pathData for post-knife/boolean/paint fidelity (kus)
  const fill = layer.fillColor || "@android:color/transparent";
  const stroke = layer.strokeColor || "";
  const hasGradient = Boolean(layer.fillGradient);
  const aaptNs = hasGradient ? `\n    xmlns:aapt="http://schemas.android.com/aapt"` : "";
  const fillAttr = hasGradient
    ? ""
    : `
      android:fillColor="${escapeXml(fill)}"`;
  return `<vector xmlns:android="http://schemas.android.com/apk/res/android"${aaptNs}
    android:width="${width}dp"
    android:height="${height}dp"
    android:viewportWidth="${viewBoxWidth}"
    android:viewportHeight="${viewBoxHeight}">
  <path
      android:name="${escapeXml(safeName(layer.name))}"
      android:pathData="${escapeXml(d)}"${fillAttr}${
        stroke
          ? `
      android:strokeColor="${escapeXml(stroke)}"
      android:strokeWidth="${layer.strokeWidth ?? 1}"`
          : ""
      }
      ${hasGradient ? "" : `android:fillAlpha="${layer.fillAlpha ?? 1}"\n      `}android:strokeAlpha="${layer.strokeAlpha ?? 1}"
      android:strokeLineCap="${layer.strokeLinecap ?? "butt"}"
      android:strokeLineJoin="${layer.strokeLinejoin ?? "miter"}"
      android:strokeMiterLimit="${layer.strokeMiterLimit ?? 4}"
      android:fillType="${layer.fillType === "evenOdd" ? "evenOdd" : "nonZero"}"
      android:trimPathStart="${layer.trimPathStart ?? 0}"
      android:trimPathEnd="${layer.trimPathEnd ?? 1}"
      android:trimPathOffset="${layer.trimPathOffset ?? 0}"${
        hasGradient
          ? `>${vectorDrawableGradient(layer, viewBoxWidth, viewBoxHeight)}
  </path>`
          : " />"
      }
</vector>
`;
}

export function exportAnimatedVectorDrawable(layer: Layer, options: ExportOptions = {}) {
  const { duration = 1.2 } = options;
  const name = safeName(layer.name);
  const fromD = pathToString(layer.pathData ?? layer.from); // current edited for fidelity
  const toD = pathToString(layer.to ?? layer.from);
  return `<animated-vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@drawable/${name}_vector">
  <target
      android:name="${escapeXml(name)}"
      android:animation="@animator/${name}_morph" />
</animated-vector>

<!-- ${name}_vector.xml -->
${exportVectorDrawable(layer, options)}

<!-- animator/${name}_morph.xml -->
<objectAnimator xmlns:android="http://schemas.android.com/apk/res/android"
    android:duration="${Math.round(duration * 1000)}"
    android:propertyName="pathData"
    android:valueFrom="${escapeXml(fromD)}"
    android:valueTo="${escapeXml(toD)}"
    android:valueType="pathType"
    android:interpolator="@android:interpolator/fast_out_slow_in" />
`;
}
