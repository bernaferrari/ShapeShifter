import { test, expect, devices, type Page } from "@playwright/test";

async function openPractice(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Make an icon move", exact: true }).click();
  await page.getByRole("button", { name: "Close animation exercise" }).click();
  const closePanel = page.getByRole("button", { name: "Close panel" });
  if (await closePanel.isVisible()) await closePanel.click();
  await expect(page.getByRole("region", { name: "Design", exact: true })).toHaveCount(0);
}
const art = (page: Page) => page.locator('#editor-canvas path[fill="#6366f1"]').first();

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
    .boundingBox())!;
  const frame = (await page.locator('#editor-canvas rect[fill="#ffffff"]').last().boundingBox())!;
  expect(title.y + title.height).toBeLessThanOrEqual(frame.y - 6);
});

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
    await page.getByRole("menuitem", { name: "Zoom to selection", exact: false }).click();
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
