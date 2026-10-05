import { test, expect, devices, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function project(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Project", exact: false }).click();
  const event = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const file = await event;
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  return JSON.parse(await readFile((await file.path())!, "utf8")).document;
}

async function openPractice(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Make an icon move", exact: true }).click();
  await page.getByRole("button", { name: "Close animation exercise" }).click();
  const closePanel = page.getByRole("button", { name: "Close panel" });
  if (await closePanel.isVisible()) await closePanel.click();
  await expect(page.getByRole("region", { name: "Design", exact: true })).toHaveCount(0);
}
const art = (page: Page) => page.locator('#editor-canvas path[fill="#6366f1"]').first();

test("Fit frame focuses one frame and Fit all frames restores the overview", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dismiss onboarding", exact: true }).click();
  const canvas = page.locator('#editor-canvas svg[aria-label="World canvas"]');
  const width = () => canvas.evaluate((svg) => (svg as SVGSVGElement).viewBox.baseVal.width);
  const overviewWidth = await width();
  if (info.project.name === "phone") {
    const fit = page.getByRole("button", { name: "Fit frame", exact: true });
    await expect(fit).toHaveText("Fit frame");
    await fit.click();
  } else {
    await page.getByRole("button", { name: "Zoom options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Fit frame", exact: true }).click();
  }
  await expect.poll(width).toBeLessThan(overviewWidth * 0.75);
  await page.getByRole("button", { name: "Zoom options", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Fit frame", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Fit selection", exact: false })).toBeVisible();
  await page.getByRole("menuitem", { name: "Fit all frames", exact: false }).click();
  await expect.poll(width).toBeCloseTo(overviewWidth, 4);
});

test("Fit all frames glides through intermediate camera positions through the canvas controls", async ({
  page,
}) => {
  await openPractice(page);
  for (let index = 0; index < 3; index++) {
    await page.getByRole("button", { name: "Zoom options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Zoom in", exact: false }).click();
  }
  await page.getByRole("button", { name: "Zoom options", exact: true }).click();
  await page.evaluate(() => {
    const canvas = document.querySelector('svg[aria-label="World canvas"]')!;
    const samples: string[] = [];
    const observations = { samples, done: false };
    (window as typeof window & { fitObservations: typeof observations }).fitObservations =
      observations;
    const start = performance.now();
    const sample = () => {
      samples.push(canvas.getAttribute("viewBox")!);
      if (performance.now() - start < 600) requestAnimationFrame(sample);
      else observations.done = true;
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole("menuitem", { name: "Fit all frames", exact: false }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { fitObservations: { done: boolean } }).fitObservations.done,
      ),
    )
    .toBe(true);
  const samples = await page.evaluate(
    () =>
      (window as typeof window & { fitObservations: { samples: string[] } }).fitObservations
        .samples,
  );
  expect(new Set(samples).size).toBeGreaterThan(3);
  expect(samples.at(-1)).not.toBe(samples[0]);
});

test("opening and resizing mobile sheets preserves artwork scale and uses a vertical grab handle", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Mobile workspace.");
  await openPractice(page);
  const before = (await art(page).boundingBox())!;
  const canvas = page.locator('#editor-canvas svg[aria-label="World canvas"]');
  const canvasBefore = (await canvas.boundingBox())!;
  await page.getByRole("button", { name: "Motion", exact: true }).click();
  await expect
    .poll(async () => (await art(page).boundingBox())!.width)
    .toBeCloseTo(before.width, 0);
  expect((await canvas.boundingBox())!.height).toBeCloseTo(canvasBefore.height, 4);
  const handle = page.getByRole("slider", { name: "Panel height", exact: true });
  await expect(handle).toHaveAttribute("aria-orientation", "vertical");
  await expect(page.locator('input[type="range"][aria-label="Panel height"]')).toHaveCount(0);
  const start = (await handle.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y - 80, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await handle.boundingBox())!.y).toBeLessThan(start.y - 60);
  await expect
    .poll(async () => (await art(page).boundingBox())!.width)
    .toBeCloseTo(before.width, 0);
  await expect(page.getByRole("button", { name: "Zoom options" })).toBeInViewport();
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect
    .poll(async () => (await art(page).boundingBox())!.width)
    .toBeCloseTo(before.width, 0);
});

test("frame titles stay above the artwork on phones", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "Mobile workspace.");
  await openPractice(page);
  const title = (await page
    .getByRole("button", { name: "Select frame Make this icon move", exact: true })
    .locator("[data-frame-title-text]")
    .boundingBox())!;
  const frame = (await page
    .locator("#editor-canvas [data-frame-background]")
    .last()
    .boundingBox())!;
  expect(frame.y - title.y - title.height).toBeGreaterThanOrEqual(2);
  expect(frame.y - title.y - title.height).toBeLessThanOrEqual(6);
});

test("frame top and left edges resize without moving artwork, and undo restores the boundary", async ({
  page,
}, info) => {
  await openPractice(page);
  await page.getByRole("button", { name: "Select frame Make this icon move", exact: true }).click();
  const frame = page.locator("#editor-canvas [data-frame-background]");
  const artworkBefore = (await art(page).boundingBox())!;
  const original = (await frame.last().boundingBox())!;
  const before = await project(page);
  const drag = async (handle: string, dx: number, dy: number) => {
    const target = (await page.locator(`[data-frame-resize-handle="${handle}"]`).boundingBox())!;
    const x = target.x + target.width / 2;
    const y = target.y + target.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
  };
  await expect(page.locator("[data-frame-resize-handle]")).toHaveCount(8);
  if (info.project.name === "phone") {
    const hit = (await page.locator('[data-frame-resize-handle="w"]').boundingBox())!;
    expect(hit.width).toBeCloseTo(44, 3);
    expect(hit.height).toBeCloseTo(44, 3);
  }
  await drag("w", -40, 0);
  const wider = (await frame.last().boundingBox())!;
  expect(wider.x).toBeLessThan(original.x - 25);
  expect(wider.x + wider.width).toBeCloseTo(original.x + original.width, 3);
  expect(await art(page).boundingBox()).toEqual(artworkBefore);
  await drag("n", 0, -40);
  const taller = (await frame.last().boundingBox())!;
  expect(taller.y).toBeLessThan(original.y - 25);
  expect(taller.y + taller.height).toBeCloseTo(original.y + original.height, 3);
  expect(await art(page).boundingBox()).toEqual(artworkBefore);
  await page.locator("#editor-canvas").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await frame.last().boundingBox()).toEqual(original);
  await page.screenshot({ path: `/tmp/shapeshifter-frame-controls-${info.project.name}.png` });
  const restored = await project(page);
  expect(restored.frames).toEqual(before.frames);
  expect(restored.tracks).toEqual(before.tracks);
});

for (const kind of ["frame-title", "artwork", "frame-resize"] as const) {
  test(`pinching during a ${kind} drag cancels the move and takes over the camera smoothly`, async ({
    browser,
  }, info) => {
    test.skip(info.project.name !== "desktop", "Native Chromium touch injection.");
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    try {
      const page = await context.newPage();
      await openPractice(page);
      const cdp = await context.newCDPSession(page);
      const touch = (
        type: "touchStart" | "touchMove" | "touchEnd",
        points: { id: number; x: number; y: number }[],
      ) =>
        cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: points.map((point) => ({ ...point, radiusX: 5, radiusY: 5, force: 1 })),
        });
      const title = page.getByRole("button", {
        name: "Select frame Make this icon move",
        exact: true,
      });
      if (kind === "frame-resize") await title.click();
      const before = await project(page);
      const target =
        kind === "frame-title"
          ? title
          : kind === "artwork"
            ? art(page)
            : page.locator('[data-frame-resize-handle="nw"]');
      const box = (await target.boundingBox())!;
      const a = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const canvas = page.locator('#editor-canvas svg[aria-label="World canvas"]');
      const view = () =>
        canvas.evaluate((svg) => {
          const { x, y, width, height } = (svg as SVGSVGElement).viewBox.baseVal;
          return { x, y, width, height };
        });
      const initial = await view();
      await touch("touchStart", [a]);
      a.x += 24;
      await touch("touchMove", [a]);
      const b = { id: 2, x: a.x, y: a.y + 130 };
      await touch("touchStart", [a, b]);
      // Adding the second contact must not change the camera.
      expect(await view()).toEqual(initial);
      b.y += 65;
      await touch("touchMove", [a, b]);
      await expect.poll(async () => (await view()).width).toBeCloseTo(initial.width / 1.5, 3);
      const pinched = await view();
      // Lifting one finger does not resume the cancelled artwork drag.
      await touch("touchEnd", [a]);
      a.x += 40;
      await touch("touchMove", [a]);
      await touch("touchEnd", []);
      expect(await view()).toEqual(pinched);
      await page.waitForTimeout(250);
      expect(await view()).toEqual(pinched);
      const after = await project(page);
      expect(after.frames).toEqual(before.frames);
      expect(after.nodes).toEqual(before.nodes);
      expect(after.tracks).toEqual(before.tracks);
    } finally {
      await context.close();
    }
  });
}

test("native phone touches pinch, release outside, edit with one finger, and drag the sheet without zooming", async ({
  browser,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "Chromium native touch injection with an Android viewport.",
  );
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openPractice(page);
    const cdp = await context.newCDPSession(page);
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
      points: { id: number; x: number; y: number }[],
    ) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((point) => ({ ...point, radiusX: 5, radiusY: 5, force: 1 })),
      });
    const canvas = page.locator('#editor-canvas svg[aria-label="World canvas"]');
    const zoom = () => canvas.evaluate((svg) => (svg as SVGSVGElement).viewBox.baseVal.width);
    const bounds = (await canvas.boundingBox())!;
    const y = bounds.y + 120;
    const initial = await zoom();
    await touch("touchStart", [{ id: 1, x: 110, y }]);
    await touch("touchStart", [
      { id: 1, x: 110, y },
      { id: 2, x: 250, y },
    ]);
    await touch("touchMove", [
      { id: 1, x: 80, y },
      { id: 2, x: 290, y },
    ]);
    await expect.poll(zoom).toBeLessThan(initial * 0.8);
    // Captured fingers travel over the bottom panel bar and end outside the SVG.
    const outsideY = bounds.y + bounds.height + 20;
    await touch("touchMove", [
      { id: 1, x: 80, y: outsideY },
      { id: 2, x: 290, y: outsideY },
    ]);
    await touch("touchEnd", []);
    const pinched = await zoom();
    await touch("touchStart", [{ id: 3, x: 30, y }]);
    await touch("touchMove", [{ id: 3, x: 75, y: y + 50 }]);
    await touch("touchEnd", []);
    expect(await zoom()).toBeCloseTo(pinched, 5);
    await page.getByRole("button", { name: "Motion", exact: true }).tap();
    const handle = page.getByRole("slider", { name: "Panel height", exact: true });
    await expect(handle).toBeVisible();
    // Wait for the opening motion to settle before taking the drag baseline.
    await expect
      .poll(async () => Math.round((await handle.boundingBox())!.y))
      .toBeLessThan(bounds.y + bounds.height * 0.6);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
    const grab = (await handle.boundingBox())!;
    const x = grab.x + grab.width / 2;
    const startY = grab.y + grab.height / 2;
    await touch("touchStart", [{ id: 4, x, y: startY }]);
    await touch("touchMove", [{ id: 4, x, y: startY - 80 }]);
    await touch("touchEnd", []);
    await expect.poll(async () => (await handle.boundingBox())!.y).toBeCloseTo(grab.y - 80, 0);
    expect(await zoom()).toBeCloseTo(pinched, 5);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await expect(page.getByRole("button", { name: "Zoom options" })).toBeInViewport();
    await page.getByRole("button", { name: "Zoom options" }).tap();
    await page.getByRole("menuitem", { name: "Fit selection", exact: false }).click();
    await page.screenshot({ path: "/tmp/shapeshifter-mobile-motion.png" });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("the sheet stays resizable in a short viewport and supports keyboard resizing", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Mobile sheet controls.");
  await page.setViewportSize({ width: 390, height: 420 });
  await openPractice(page);
  await page.getByRole("button", { name: "Motion", exact: true }).click();
  const handle = page.getByRole("slider", { name: "Panel height", exact: true });
  await handle.focus();
  await handle.press("End");
  const maximum = Number(await handle.getAttribute("aria-valuemax"));
  await expect(handle).toHaveAttribute("aria-valuenow", String(maximum));
  await handle.press("ArrowDown");
  await expect(handle).toHaveAttribute("aria-valuenow", String(maximum - 32));
  const grab = (await handle.boundingBox())!;
  const x = grab.x + grab.width / 2;
  const y = grab.y + grab.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30, { steps: 6 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", String(maximum - 62));
  await handle.focus();
  await handle.press("Escape");
  await expect(handle).toHaveCount(0);
  await expect(page.locator("#editor-canvas")).toBeFocused();
});
