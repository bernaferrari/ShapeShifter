import paper from "paper/dist/paper-core";
import { parsePath } from "./pathDataIO";
import { validatePathData } from "./pathValidation";
import type { BooleanOp, BooleanOptions } from "./booleanOperations";
import type { PathData } from "../types";

/** Geometry calculations must use authored doubles, independent of display rounding. */
function precisePathData(path: PathData) {
  return path.subPaths
    .flatMap((contour) =>
      contour.commands.map((command) => {
        if (command.type === "Z") return "Z";
        if (command.type === "A" && command.arcParams) {
          const arc = command.arcParams,
            end = command.points.at(-1)!;
          return `A${arc.rx} ${arc.ry} ${arc.xRotation} ${arc.largeArc ? 1 : 0} ${arc.sweep ? 1 : 0} ${end.x} ${end.y}`;
        }
        return `${command.type === "H" || command.type === "V" ? "L" : command.type}${command.points.map((point) => `${point.x} ${point.y}`).join(" ")}`;
      }),
    )
    .join(" ");
}

/** Paper's area tracer splits Bézier segments at crossings without polygon flattening. */
export function combineCurveAreas(
  operation: BooleanOp,
  first: PathData,
  second: PathData,
  options: BooleanOptions = {},
): PathData {
  const scope = new paper.PaperScope();
  new scope.Project(new scope.Size(1, 1));
  try {
    const create = (
      data: PathData,
      fill: "nonZero" | "evenOdd" = "nonZero",
      matrix?: BooleanOptions["firstMatrix"],
    ) => {
      const pathData = precisePathData(data);
      const error = pathData.trim() ? validatePathData(pathData) : null;
      if (error) throw new Error("A selected path has unsupported or out-of-range geometry.");
      const path = new scope.CompoundPath({ pathData, insert: false });
      path.fillRule = fill === "evenOdd" ? "evenodd" : "nonzero";
      if (matrix)
        path.transform(
          new scope.Matrix(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f),
        );
      return path;
    };
    const a = create(first, options.firstFillType, options.firstMatrix);
    const b = create(second, options.secondFillType, options.secondMatrix);
    const result =
      operation === "union"
        ? a.unite(b, { insert: false })
        : operation === "subtract"
          ? a.subtract(b, { insert: false })
          : operation === "intersect"
            ? a.intersect(b, { insert: false })
            : a.exclude(b, { insert: false });
    // getPathData is Paper's pathData getter; passing precision avoids its
    // display-oriented five decimal rounding at high zoom or small scales.
    const data = (
      result as paper.PathItem & { getPathData(matrix: null, precision: number): string }
    ).getPathData(null, 12);
    if (!data.trim()) return { subPaths: [] };
    const error = validatePathData(data);
    if (error) throw new Error("The combined path exceeds the document's geometry limits.");
    return parsePath(data);
  } finally {
    (scope as paper.PaperScope & { remove(): void }).remove();
  }
}
