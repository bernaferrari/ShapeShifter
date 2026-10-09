import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { EditorDocument } from "../lib/pathshift/types";

async function download(page: Page, format: string) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: format, exact: false }).click();
  const button = dialog.getByRole("button", { name: "Export", exact: true });
  await expect(button).toBeEnabled();
  const event = page.waitForEvent("download");
  await button.click();
  const file = await event;
  await expect(dialog).not.toBeVisible();
  return { filename: file.suggestedFilename(), content: await readFile((await file.path())!) };
}
async function nativeProject(page: Page): Promise<EditorDocument> {
  const output = await download(page, "Project");
  const project = JSON.parse(output.content.toString());
  expect(Object.keys(project).sort()).toEqual(["activeOwnerId", "document", "format"]);
  expect(project.format).toBe("pathshift");
  expect(project.document.schema).toBe("pathshift");
  return project.document;
}
async function focusCanvas(page: Page) {
  await page.locator("#editor-canvas").focus();
}

test("create, group, animate, duplicate, undo, save, reload, and export through controls", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "The full keyboard journey is a desktop workflow.");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Make an icon move", exact: true }).click();
  await page.getByRole("button", { name: "Close animation exercise" }).click();
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+g");
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Group");
  await page.getByRole("button", { name: "Animate Position", exact: true }).click();
  const playhead = page.getByRole("slider", { name: "Timeline playhead" });
  await playhead.focus();
  await playhead.press("End");
  const x = page.getByRole("textbox", { name: "X", exact: true });
  await x.fill("8");
  await x.press("Enter");
  // Position keys as one property: editing X also keys Y at its current value.
  await expect(
    page.getByRole("button", { name: "Select X for Group keyframe", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Keyframe · 1000 ms", { exact: true })).toBeVisible();
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+d");
  const duplicated = await nativeProject(page);
  const practice = Object.values(duplicated.frames).find(
    (frame) => frame.name === "Make this icon move",
  )!;
  expect(practice.childrenNodeIds).toHaveLength(2);
  const clone = practice.childrenNodeIds
    .map((id) => duplicated.nodes[id]!)
    .find((node) => node.name === "Group copy")!;
  expect(clone.childrenIds).toHaveLength(1);
  expect(
    Object.values(duplicated.tracks).filter((track) => track.target.nodeId === clone.id),
  ).toHaveLength(2);
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+z");
  const saved = await nativeProject(page);
  expect(saved.frames[practice.id]!.childrenNodeIds).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Saved locally", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Saved locally", exact: true })).toBeVisible();
  const restored = await nativeProject(page);
  expect(restored).toEqual(saved);
  const staticSvg = await download(page, "SVG Web · static");
  expect(staticSvg.content.toString()).toContain("#6366f1");
  expect(staticSvg.content.toString()).toContain('viewBox="0 0 32 24"');
  const android = await download(page, "Animated Vector");
  expect(android.filename).toMatch(/\.zip$/);
  expect(android.content.length).toBeGreaterThan(200);
  expect(errors).toEqual([]);
});

test("copy A, duplicate B, paste still produces A through keyboard commands", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Desktop keyboard shortcuts.");
  await page.goto("/");
  await page.getByRole("button", { name: "Make an icon move", exact: true }).click();
  await page.getByRole("button", { name: "Close animation exercise" }).click();
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("New path layer");
  await page.getByRole("option", { name: "New path layer", exact: false }).click();
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toHaveValue(/^Path layer/);
  await name.fill("Object B");
  await name.press("Enter");
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Moving icon copy",
  );
  const document = await nativeProject(page);
  const practice = Object.values(document.frames).find(
    (frame) => frame.name === "Make this icon move",
  )!;
  const nodes = practice.childrenNodeIds.map((id) => document.nodes[id]!);
  expect(nodes.map((node) => node.name)).toEqual([
    "Moving icon",
    "Object B",
    "Object B copy",
    "Moving icon copy",
  ]);
});

test("guided animation and exact mobile values survive panels, landscape, and a short viewport", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Make an icon move", exact: true }).click();
  await page.getByRole("button", { name: "Enable motion", exact: true }).click();
  await page.getByRole("button", { name: "Go to 500 ms", exact: true }).click();
  const x = page.getByRole("textbox", { name: "X", exact: true });
  await x.fill("8");
  await x.press("Enter");
  await expect(page.getByRole("button", { name: "Preview motion", exact: true })).toBeVisible();
  if (info.project.name === "phone") {
    await expect(x).toHaveCSS("font-size", "16px");
    await page
      .getByRole("navigation", { name: "Panels" })
      .getByRole("button", { name: "Motion", exact: true })
      .click();
    await expect(page.getByRole("slider", { name: "Timeline playhead" })).toBeVisible();
    await page.getByRole("button", { name: "Edit X easing", exact: true }).first().click();
    await page.getByRole("combobox", { name: "X easing", exact: true }).selectOption("LINEAR");
    await page.getByRole("button", { name: "Close easing editor", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: "X", exact: true })).toHaveValue("8");
    await page.setViewportSize({ width: 390, height: 420 });
    await expect(page.getByRole("button", { name: "Close panel" })).toBeInViewport();
    await page.getByRole("textbox", { name: "X", exact: true }).fill("9");
    await page.getByRole("textbox", { name: "X", exact: true }).press("Enter");
    await page.getByRole("button", { name: "Close panel" }).click();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByRole("navigation", { name: "Panels" })).toBeVisible();
    await page.getByRole("button", { name: "Design", exact: true }).click();
    const landscapeX = page.getByRole("textbox", { name: "X", exact: true });
    await landscapeX.fill("10");
    await landscapeX.press("Enter");
    await expect(landscapeX).toBeInViewport();
    await page.getByRole("button", { name: "Close panel" }).click();
  }
  await page.getByRole("button", { name: "Preview motion", exact: true }).click();
  await expect(
    page.getByText("Export Animated Vector or Lottie, or save a Project file.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).first().click();
  await nativeProject(page);
  await expect(page.getByText("You made an icon move.", { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test("morph demo preview is the generated output and uses the same settings as download", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dismiss onboarding" }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Experimental morph demos" }).click();
  await dialog.getByRole("radio", { name: "Morph SVG", exact: false }).click();
  await expect(dialog.getByText("Experimental morph demo.", { exact: false })).toBeVisible();
  const preview = dialog.locator('iframe[title="Generated morph demo preview"]');
  await expect(preview).toBeVisible();
  const source = decodeURIComponent(
    (await preview.getAttribute("src"))!.split(",").slice(1).join(","),
  );
  expect(source).toContain('fill="#0f172a"');
  const event = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const result = await event;
  expect(await readFile((await result.path())!, "utf8")).toBe(source);
});
