import { test, expect } from "@playwright/test";

test("next-pose guide follows authored keys, survives reload and stays out of playback", async ({
  page,
}, info) => {
  const mobile = info.project.name === "phone";
  const openPanel = async (name: "Motion" | "Design") => {
    if (!mobile) return;
    const button = page
      .getByRole("navigation", { name: "Panels" })
      .getByRole("button", { name, exact: true });
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Make an icon move", exact: true }).click();
  await page.getByRole("button", { name: "Close animation exercise" }).click();
  await page.getByRole("button", { name: "Animate Position", exact: true }).click();
  await openPanel("Motion");
  const time = page.getByRole("textbox", { name: "Current time in milliseconds" });
  await time.fill("1000");
  await time.press("Enter");
  await openPanel("Design");
  const x = page.getByRole("textbox", { name: "X", exact: true });
  await x.fill("20");
  await x.press("Enter");
  await openPanel("Motion");
  await time.fill("0");
  await time.press("Enter");
  const preview = page.locator("[data-next-pose-owner]");
  await expect(preview).toHaveCount(0);
  const closeKeyEditor = page.getByRole("button", { name: "Close keyframe editor", exact: true });
  if (await closeKeyEditor.isVisible()) await closeKeyEditor.click();
  const options = page.getByRole("button", { name: "Timeline options" });
  await options.click();
  await page.getByRole("menuitemcheckbox", { name: "Show next keyframe", exact: true }).click();
  await expect(preview).toHaveAttribute("data-next-pose-time", "1000");
  await expect(preview).toHaveAttribute("pointer-events", "none");
  await expect(preview).toContainText("Next · 1000 ms");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `/tmp/pathshift-next-pose-${info.project.name}.png` });

  // Inserting an intermediate key changes the preview target from the final pose.
  await page.getByRole("button", { name: "Select X track for Moving icon", exact: true }).click();
  await time.fill("400");
  await time.press("Enter");
  await options.click();
  await page.getByRole("menuitem", { name: "Add keyframe at playhead", exact: true }).click();
  if (await closeKeyEditor.isVisible()) await closeKeyEditor.click();
  await time.fill("0");
  await time.press("Enter");
  await expect(preview).toHaveAttribute("data-next-pose-time", "400");
  await time.fill("400");
  await time.press("Enter");
  await expect(preview).toHaveAttribute("data-next-pose-time", "1000");
  await time.fill("1000");
  await time.press("Enter");
  await expect(preview).toHaveCount(0);
  await time.fill("0");
  await time.press("Enter");
  const transport = mobile
    ? page.getByRole("region", { name: "Motion", exact: true })
    : page.getByRole("banner", { name: "Editor toolbar" });
  await transport.getByRole("button", { name: "Play", exact: true }).click();
  await expect(transport.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
  await transport.getByRole("button", { name: "Pause", exact: true }).click();
  await time.fill("0");
  await time.press("Enter");
  await expect(preview).toHaveAttribute("data-next-pose-time", "400");
  if (!mobile)
    await expect(page.getByRole("button", { name: "Saved locally", exact: true })).toBeVisible();
  await page.reload();
  await openPanel("Motion");
  await options.click();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Show next keyframe", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemcheckbox", { name: "Show next keyframe", exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(errors).toEqual([]);
});
