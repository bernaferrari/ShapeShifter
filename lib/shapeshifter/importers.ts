import { parsePath } from "./pathUtils";
import type { FillType, Layer, StrokeLineCap, StrokeLineJoin } from "./types";

const pathFromRect = (element: Element) => {
  const x = Number(element.getAttribute("x") ?? 0);
  const y = Number(element.getAttribute("y") ?? 0);
  const width = Number(element.getAttribute("width") ?? 0);
  const height = Number(element.getAttribute("height") ?? 0);
  return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`;
};

const pathFromCircle = (element: Element) => {
  const cx = Number(element.getAttribute("cx") ?? 0);
  const cy = Number(element.getAttribute("cy") ?? 0);
  const rx = Number(element.getAttribute("r") ?? element.getAttribute("rx") ?? 0);
  const ry = Number(element.getAttribute("r") ?? element.getAttribute("ry") ?? rx);
  const k = 0.552284749831;
  return [
    `M ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry}`,
    `C ${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy}`,
    "Z",
  ].join(" ");
};

const pathFromLine = (element: Element) => {
  const x1 = Number(element.getAttribute("x1") ?? 0);
  const y1 = Number(element.getAttribute("y1") ?? 0);
  const x2 = Number(element.getAttribute("x2") ?? 0);
  const y2 = Number(element.getAttribute("y2") ?? 0);
  return `M ${x1} ${y1} L ${x2} ${y2}`;
};

const pathFromPoints = (element: Element, close: boolean) => {
  const points = (element.getAttribute("points") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (points.length < 2) return "";
  const commands = [`M ${points[0]} ${points[1]}`];
  for (let index = 2; index + 1 < points.length; index += 2) {
    commands.push(`L ${points[index]} ${points[index + 1]}`);
  }
  if (close) commands.push("Z");
  return commands.join(" ");
};

function getStyle(element: Element) {
  const fill = element.getAttribute("fill") ?? "";
  const stroke = element.getAttribute("stroke") ?? "";
  const fillOpacity = Number(element.getAttribute("fill-opacity") ?? 1);
  const strokeOpacity = Number(element.getAttribute("stroke-opacity") ?? 1);
  const strokeWidth = Number(element.getAttribute("stroke-width") ?? 0);
  return {
    fillColor: fill === "none" ? "" : fill,
    fillAlpha: Number.isFinite(fillOpacity) ? fillOpacity : 1,
    strokeColor: stroke === "none" ? "" : stroke,
    strokeAlpha: Number.isFinite(strokeOpacity) ? strokeOpacity : 1,
    strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth : 0,
    strokeLinecap: (element.getAttribute("stroke-linecap") ?? "butt") as StrokeLineCap,
    strokeLinejoin: (element.getAttribute("stroke-linejoin") ?? "miter") as StrokeLineJoin,
    strokeMiterLimit: Number(element.getAttribute("stroke-miterlimit") ?? 4),
    fillType: ((element.getAttribute("fill-rule") ?? "nonzero") === "evenodd"
      ? "evenOdd"
      : "nonZero") as FillType,
  };
}

function layerFromPathData(name: string, pathData: string, id: string, style = {}) {
  const parsed = parsePath(pathData);
  return {
    id,
    name,
    type: "path",
    from: parsed,
    to: parsed,
    pathData: parsed,
    visible: true,
    locked: false,
    ...style,
  } satisfies Layer;
}

export function importLayersFromSvg(svgText: string, namePrefix = "svg") {
  const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const elements = Array.from(
    document.querySelectorAll("path, rect, circle, ellipse, line, polygon, polyline"),
  );

  return elements.flatMap((element, index) => {
    const tag = element.tagName.toLowerCase();
    const pathData =
      tag === "path"
        ? element.getAttribute("d") ?? ""
        : tag === "rect"
          ? pathFromRect(element)
          : tag === "circle" || tag === "ellipse"
            ? pathFromCircle(element)
            : tag === "line"
              ? pathFromLine(element)
              : tag === "polygon"
                ? pathFromPoints(element, true)
                : pathFromPoints(element, false);

    if (!pathData.trim()) return [];
    const name = element.getAttribute("id") || `${namePrefix}_${tag}_${index + 1}`;
    return [layerFromPathData(name, pathData, `${Date.now()}_${index}`, getStyle(element))];
  });
}

export function importLayersFromVectorDrawable(xmlText: string) {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  const paths = Array.from(document.querySelectorAll("path"));
  return paths.flatMap((element, index) => {
    const pathData = element.getAttribute("android:pathData") ?? element.getAttribute("pathData") ?? "";
    if (!pathData.trim()) return [];
    const name = element.getAttribute("android:name") ?? element.getAttribute("name") ?? `path_${index + 1}`;
    const parsed = parsePath(pathData);
    return [{
      id: `${Date.now()}_${index}`,
      name,
      type: "path" as const,
      from: parsed,
      to: parsed,
      pathData: parsed,
      visible: true,
      locked: false,
      fillColor: element.getAttribute("android:fillColor") ?? "",
      fillAlpha: Number(element.getAttribute("android:fillAlpha") ?? 1),
      strokeColor: element.getAttribute("android:strokeColor") ?? "",
      strokeAlpha: Number(element.getAttribute("android:strokeAlpha") ?? 1),
      strokeWidth: Number(element.getAttribute("android:strokeWidth") ?? 0),
      strokeLinecap: (element.getAttribute("android:strokeLineCap") ?? "butt") as StrokeLineCap,
      strokeLinejoin: (element.getAttribute("android:strokeLineJoin") ?? "miter") as StrokeLineJoin,
      strokeMiterLimit: Number(element.getAttribute("android:strokeMiterLimit") ?? 4),
      trimPathStart: Number(element.getAttribute("android:trimPathStart") ?? 0),
      trimPathEnd: Number(element.getAttribute("android:trimPathEnd") ?? 1),
      trimPathOffset: Number(element.getAttribute("android:trimPathOffset") ?? 0),
      fillType: (element.getAttribute("android:fillType") === "evenOdd" ? "evenOdd" : "nonZero") as FillType,
    } satisfies Layer];
  });
}
