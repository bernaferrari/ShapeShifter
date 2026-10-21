// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { EditorCommandPalette } from "../EditorDialogs";
import { renderEditorComponent, type RenderedEditorComponent } from "./renderEditorComponent";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent | null = null;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});

const noop = () => {};
async function search(text: string) {
  rendered = renderEditorComponent(
    <EditorCommandPalette
      open
      onOpenChange={noop}
      onOpenHelp={noop}
      onLoadSample={noop}
      onExport={noop}
      onOpenImport={noop}
      onNewProject={noop}
      onToggleLayers={noop}
      onToggleInspector={noop}
      onToggleTimeline={noop}
      onToggleRulers={noop}
      onResetViews={noop}
    />,
  );
  const input = document.querySelector<HTMLInputElement>("[cmdk-input]")!;
  React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // cmdk sorts the list in a scheduled effect after filtering.
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // The label, without the section name shown beside search results.
  return [...document.querySelectorAll<HTMLElement>("[cmdk-item]")].map((item) =>
    item.querySelector(".flex-1")?.textContent?.trim(),
  );
}

describe("command palette ranking", () => {
  it("puts New project first when searching for new", async () => {
    expect((await search("new"))[0]).toBe("New project…");
  });

  it("ranks commands whose label starts with the search above fuzzy matches", async () => {
    const results = await search("export");
    expect(results[0]).toMatch(/^Export /);
    expect(results.findIndex((label) => label?.includes("experimental"))).toBeGreaterThan(
      results.findIndex((label) => label === "Export SVG"),
    );
  });
});
