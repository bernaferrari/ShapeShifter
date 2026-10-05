import { test, expect, devices, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function practice(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Make an icon move", exact: true }).click();
  await page.getByRole("button", { name: "Close animation exercise" }).click();
  await page.getByRole("button", { name: "Return to canvas" }).click();
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

test("mobile tools explain modes and put object actions on the selection", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Touch workspace.");
  await practice(page);
  await expect(page.getByRole("button", { name: "Select objects", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Add artwork", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Ellipse", exact: true }).tap();
  await expect(page.getByText("Ellipse · Drag to draw", { exact: true })).toBeVisible();
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
  await expect(
    page.getByText("Drag anywhere to pan · Pinch to zoom", { exact: true }),
  ).toBeVisible();
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
  await expect(page.getByText(/Select a track|Move between keys/)).toBeVisible();
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
  const add = page.getByRole("button", { name: "Add keyframe at playhead", exact: true });
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
