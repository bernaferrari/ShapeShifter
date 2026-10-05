import { test, expect, devices, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function practice(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Make an icon move", exact: true }).click();
  await page.getByRole("button", { name: "Close animation exercise" }).click();
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.getByRole("region", { name: "Design", exact: true })).toHaveCount(0);
}
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

test("mobile tools switch modes and keep object actions in a compact toolbar", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Touch workspace.");
  await practice(page);
  await page.setViewportSize({ width: 320, height: 700 });
  const tools = page.getByRole("toolbar", { name: "Canvas tools", exact: true });
  await expect(tools).toBeInViewport();
  const toolBounds = (await tools.boundingBox())!;
  expect(toolBounds.height).toBe(44);
  expect(toolBounds.width).toBeLessThan(220);
  await expect(page.getByText("Tap to select", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select objects", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Add artwork", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Ellipse", exact: true }).tap();
  await expect(
    page
      .getByRole("toolbar", { name: "Active drawing tool" })
      .getByText("Ellipse", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done drawing", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Select objects", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Actions for Moving icon", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Actions for Moving icon copy", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Actions for Moving icon", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move canvas", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Move canvas", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Fit active frame", exact: true }),
  ).toBeInViewport();
});

test("Motion labels playback and keyframe actions and inserts only into the selected track", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Touch motion controls.");
  await practice(page);
  await page.getByRole("button", { name: "Design", exact: true }).tap();
  await page.getByRole("button", { name: "Animate Position", exact: true }).tap();
  await page.getByRole("button", { name: "Motion", exact: true }).tap();
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toHaveCount(1);
  await expect(play).toHaveText("Play");
  await expect(
    page.getByRole("button", { name: "Add keyframe at playhead", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Timeline options", exact: true }).tap();
  await expect(
    page.getByRole("menuitem", { name: "Add keyframe at playhead", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  const playhead = page.getByRole("slider", { name: "Timeline playhead", exact: true });
  await playhead.focus();
  await playhead.press("End");
  await page.getByRole("button", { name: "Design", exact: true }).tap();
  const x = page.getByRole("textbox", { name: "X", exact: true });
  await x.fill("8");
  await x.press("Enter");
  await page.getByRole("button", { name: "Motion", exact: true }).tap();
  await page.getByRole("button", { name: "Select X track for Moving icon", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Select X track for Moving icon", exact: true }),
  ).toHaveText("X");
  await expect(
    page.getByRole("button", { name: "Select Y track for Moving icon", exact: true }),
  ).toHaveText("Y");
  const time = page.getByRole("textbox", { name: "Current time in milliseconds", exact: true });
  await time.fill("500");
  await time.press("Enter");
  await page.getByRole("button", { name: "Timeline options", exact: true }).tap();
  const add = page.getByRole("menuitem", { name: "Add keyframe at playhead", exact: true });
  await expect(add).toHaveText("Add keyframe");
  await add.tap();
  await expect(
    page.getByRole("button", { name: "X end keyframe at 500 milliseconds", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Y end keyframe at 500 milliseconds", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "X end keyframe at 500 milliseconds", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "/tmp/shapeshifter-mobile-clear-motion.png" });
});

test("native touch navigation pans empty space and artwork in Move view without editing the document", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "desktop", "Android native touch injection.");
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await practice(page);
    const before = await project(page);
    const cdp = await context.newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x = 0, y = 0) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ id: 1, x, y, radiusX: 5, radiusY: 5, force: 1 }],
      });
    const art = page.locator('#editor-canvas path[fill="#6366f1"]').first();
    const initial = (await art.boundingBox())!;
    const canvas = page.locator('svg[aria-label="World canvas"]');
    const bounds = (await canvas.boundingBox())!;
    const blank = { x: 20, y: bounds.y + 70 };
    await touch("touchStart", blank.x, blank.y);
    await page.waitForTimeout(550);
    await expect(page.getByRole("menu")).toHaveCount(0);
    for (let step = 1; step <= 6; step++) await touch("touchMove", blank.x + step * 6, blank.y);
    await touch("touchEnd");
    await expect.poll(async () => (await art.boundingBox())!.x).toBeCloseTo(initial.x + 36, 0);
    await expect(
      page.getByRole("button", { name: "Actions for Moving icon", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Move canvas", exact: true }).tap();
    const selected = (await art.boundingBox())!;
    const start = { x: selected.x + selected.width / 2, y: selected.y + selected.height / 2 };
    await touch("touchStart", start.x, start.y);
    for (let step = 1; step <= 5; step++)
      await touch("touchMove", start.x + step * 8, start.y + step * 4);
    await touch("touchEnd");
    await expect.poll(async () => (await art.boundingBox())!.x).toBeCloseTo(selected.x + 40, 0);
    expect((await art.boundingBox())!.width).toBeCloseTo(initial.width, 4);
    expect(await project(page)).toEqual(before);
    await page.getByRole("button", { name: "Fit active frame", exact: true }).tap();
    await expect(
      page.getByRole("button", { name: "Actions for Moving icon", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "/tmp/shapeshifter-mobile-clear-canvas.png" });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("recovery notice stays inside a narrow viewport and preserves the unopened save", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: "Dismiss onboarding", exact: true }).click();
  const preserved = "unreadable saved project";
  await page.evaluate(async (payload) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("shapeshifter", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("autosave", "readwrite");
      transaction.objectStore("autosave").put(payload, "document");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, preserved);
  await page.reload();
  const notice = page.locator("[data-sonner-toast]").filter({ hasText: "Autosave paused" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Export to save new edits.");
  await expect.poll(async () => (await notice.boundingBox())!.y).toBeCloseTo(56, 0);
  const box = (await notice.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(12);
  expect(box.x + box.width).toBeLessThanOrEqual(308);
  expect(await notice.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("shapeshifter", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const payload = await new Promise<unknown>((resolve) => {
      const request = db
        .transaction("autosave", "readonly")
        .objectStore("autosave")
        .get("document");
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return payload;
  });
  expect(stored).toBe(preserved);
  await page.screenshot({ path: `/tmp/shapeshifter-recovery-${info.project.name}.png` });
});

test("every mobile panel uses one header row for its actions, grab handle, and close button", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Compact panel composition.");
  await practice(page);
  await page.setViewportSize({ width: 320, height: 700 });
  for (const name of ["Layers", "Design", "Motion"]) {
    await page.getByRole("button", { name, exact: true }).tap();
    const panel = page.getByRole("region", { name, exact: true });
    const header = panel.locator("[data-panel-header]");
    await expect(header).toHaveCount(1);
    const handle = header.getByRole("slider", { name: "Panel height", exact: true });
    const close = header.getByRole("button", { name: "Close panel", exact: true });
    await expect(handle).toBeInViewport();
    await expect(close).toBeInViewport();
    const geometry = await header.evaluate((element) => ({
      y: element.getBoundingClientRect().y,
      height: element.getBoundingClientRect().height,
      targets: [...element.querySelectorAll('button, [role="slider"]')].map((target) => {
        const box = target.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    }));
    expect(geometry.height).toBe(44);
    const handleBox = (await handle.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    expect(
      Math.abs(handleBox.x + handleBox.width / 2 - panelBox.x - panelBox.width / 2),
    ).toBeLessThanOrEqual(0.5);
    let previousRight = 0;
    for (const box of geometry.targets) {
      expect(Math.abs(box.y - geometry.y)).toBeLessThanOrEqual(2);
      expect(box.height).toBe(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(previousRight);
      previousRight = box.x + box.width;
    }
    expect(previousRight).toBeLessThanOrEqual(320);
    if (name === "Layers") {
      await expect(header.getByText("Layers", { exact: true })).toHaveCount(1);
      await header.getByRole("button", { name: "Search layers", exact: true }).tap();
      await expect(panel.getByRole("textbox", { name: "Find a layer", exact: true })).toBeVisible();
      await header.getByRole("button", { name: "Close layer search", exact: true }).tap();
      await header.getByRole("button", { name: "Add layer", exact: true }).tap();
      await expect(page.getByRole("menuitem", { name: "Group", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(0);
    }
    if (name === "Design") {
      await header.getByRole("button", { name: "Layer actions", exact: true }).tap();
      await expect(
        page.getByRole("menuitem", { name: "Edit start and end paths", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Use as mask", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(0);
    }
    await page.screenshot({ path: `/tmp/shapeshifter-single-header-${name.toLowerCase()}.png` });
    await close.tap();
    await expect(panel).toHaveCount(0);
  }
});
