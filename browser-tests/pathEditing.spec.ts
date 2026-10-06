import { readFile } from "node:fs/promises";
import { androidPathMorphSignature, parsePath } from "../lib/shapeshifter/pathUtils";
import type { EditorDocument } from "../lib/shapeshifter/types";
import { test, expect } from "@playwright/test";

test("line to curve conversion remains draggable in the vector editor", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Desktop inspector reproduction.");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Make an icon move", exact: true }).click();
  await page.getByRole("button", { name: "Close animation exercise" }).click();
  await page.getByRole("button", { name: "Focus path commands" }).click();
  await page.getByRole("button", { name: "Line", exact: true }).first().click();
  await page.getByRole("button", { name: "Exit focus (Esc)" }).click();
  await page.locator("#editor-canvas").focus();
  await page.keyboard.press("a");
  const points = page.locator('#editor-canvas svg rect[style*="cursor: grab"]');
  await expect(points.first()).toBeVisible();
  const box = (await points.first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await points.first().boundingBox())?.x)
    .toBeGreaterThan(box.x + 20);
  await expect(page.locator("#editor-canvas")).toBeVisible();
  expect(errors).toEqual([]);
});

test("converted line points in the authored triangle remain draggable at every pose", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Desktop reproduction.");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Dismiss onboarding", exact: true }).click();
  await page.getByRole("button", { name: "Upper", exact: true }).first().click();
  await page.locator("#editor-canvas").focus();
  await page.keyboard.press("a");
  for (const time of [0, 500, 1000]) {
    const timeInput = page.getByRole("textbox", { name: "Current time in milliseconds" });
    await timeInput.fill(String(time));
    await timeInput.press("Enter");
    await page.getByRole("button", { name: "Focus path commands" }).click();
    await page.getByRole("button", { name: "Line", exact: true }).first().click();
    await page.getByRole("button", { name: "Exit focus (Esc)" }).click();
    const points = page.locator('#editor-canvas svg :is(rect,circle)[style*="cursor: grab"]');
    for (let index = 0; index < Math.min(7, await points.count()); index++) {
      const box = (await points.nth(index).boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 10, { steps: 3 });
      await page.mouse.up();
      expect(errors).toEqual([]);
    }
  }
});

test("touch dragging a converted triangle point keeps the focused command editor alive", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "desktop", "Native Chromium touch injection.");
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
    await page.goto("/");
    await page.getByRole("button", { name: "Dismiss onboarding", exact: true }).click();
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await page.getByRole("button", { name: "Focus path commands" }).click();
    for (let index = 0; index < 3; index++)
      await page.getByRole("button", { name: "Line", exact: true }).first().tap();
    await page.locator("#editor-canvas").focus();
    await page.keyboard.press("a");
    const points = page.locator('#editor-canvas svg :is(rect,circle)[style*="cursor: grab"]');
    await expect(points.first()).toBeVisible();
    const cdp = await context.newCDPSession(page);
    let dragged = 0;
    for (let index = 0; index < Math.min(10, await points.count()); index++) {
      const box = (await points.nth(index).boundingBox())!;
      if (box.y > 350 || box.y < 90) continue;
      const point = { id: index + 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      dragged++;
      point.x += 25;
      point.y += 15;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      expect(errors).toEqual([]);
      await expect(page.getByRole("button", { name: "Exit focus (Esc)" })).toBeVisible();
    }
    expect(dragged).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("add anchors, convert, undo, save and reload through the path command controls", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Dismiss onboarding", exact: true }).click();
  if (info.project.name === "phone")
    await page.getByRole("button", { name: "Design", exact: true }).click();
  else await page.getByRole("button", { name: "Upper", exact: true }).first().click();
  await page.getByRole("button", { name: "Focus path commands" }).click();
  await expect(page.getByText("5 points", { exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "Add point to shape 1", exact: true });
  await add.click();
  await expect(page.getByText("6 points", { exact: true })).toBeVisible();
  await add.click();
  await expect(page.getByText("7 points", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Line", exact: true }).first().click();
  const x = page.getByRole("textbox", { name: "Curve X", exact: true }).first();
  await x.fill("14");
  await x.press("Enter");
  await expect(x).toHaveValue("14");
  await x.fill("17");
  await x.press("Escape");
  await expect(x).toHaveValue("14");
  await page.getByRole("button", { name: "Exit focus (Esc)" }).click();
  await page.locator("#editor-canvas").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  const project = async (): Promise<EditorDocument> => {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "Project", exact: false }).click();
    const downloaded = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    const file = await downloaded;
    await expect(dialog).not.toBeVisible();
    return JSON.parse((await readFile((await file.path())!)).toString()).document;
  };
  const saved = await project();
  const keys = Object.values(saved.tracks)
    .filter(
      (track) =>
        saved.nodes[track.target.nodeId]?.name === "Upper" && track.target.property === "pathData",
    )
    .flatMap((track) => track.keyframeIds.map((id) => saved.keyframes[id].value));
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.every((value) => typeof value === "string")).toBe(true);
  expect(
    new Set(keys.map((value) => androidPathMorphSignature(parsePath(String(value))))).size,
  ).toBe(1);
  await expect(page.getByRole("button", { name: "Saved locally", exact: true, includeHidden: true })).toHaveCount(1);
  await page.reload();
  const reloaded = await project();
  expect(reloaded).toEqual(saved);
  expect(errors).toEqual([]);
});
