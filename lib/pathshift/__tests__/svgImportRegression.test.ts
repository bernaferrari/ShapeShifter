// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { importLayersFromSvg } from "../importers";
const path = '<path d="M0 0L10 0L0 10Z"/>';
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
describe("SVG import fidelity", () => {
  it("assigns independent identities to repeated grouped imports", () => {
    const a = importLayersFromSvg(svg(`<g>${path}</g>`), "icon");
    const b = importLayersFromSvg(svg(`<g>${path}</g>`), "icon");
    expect(new Set([...a, ...b].map((l) => l.id)).size).toBe(a.length + b.length);
    expect(b[1].parentId).toBe(b[0].id);
  });
  it("resolves default and inherited paint and stroke width", () => {
    expect(importLayersFromSvg(svg(path))[0].fillColor).toBe("#000000");
    const layers = importLayersFromSvg(svg(`<g fill="red" stroke="blue">${path}</g>`));
    expect(layers[1]).toMatchObject({ fillColor: "red", strokeColor: "blue", strokeWidth: 1 });
  });
  it("preserves group and leaf opacity separately", () => {
    const layers = importLayersFromSvg(
      svg('<g opacity="0.2"><path opacity="0.5" d="M0 0L1 1"/></g>'),
    );
    expect(layers[0].alpha).toBe(0.2);
    expect(layers[1].alpha).toBe(0.5);
  });
  it("preserves dash arrays", () => {
    expect(
      importLayersFromSvg(svg('<path stroke-dasharray="2 2" d="M0 0L1 1"/>'))[0].strokeDasharray,
    ).toBe("2 2");
  });
  it("scopes direct shape clipping independently of siblings", () => {
    const layers = importLayersFromSvg(
      svg(
        `<defs><clipPath id="c">${path}</clipPath></defs><path clip-path="url(#c)" d="M0 0L20 20"/>${path}`,
      ),
    );
    const clip = layers.find((l) => l.type === "clipPath")!;
    expect(clip).toBeDefined();
    expect(layers.filter((l) => l.parentId === clip.parentId)).toHaveLength(2);
    expect(layers.at(-1)!.parentId).toBeNull();
  });
});
