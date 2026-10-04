import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface RenderedEditorComponent {
  container: HTMLDivElement;
  unmount: () => void;
}

export function renderEditorComponent(node: React.ReactNode): RenderedEditorComponent {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

export function buttonWithText(container: ParentNode, text: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button"));
  const match =
    buttons.find((button) => button.textContent?.trim() === text) ??
    buttons.find((button) => button.textContent?.trim().startsWith(text));
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }
  return match;
}

/** Opens a dropdown menu from its trigger and activates the item whose text starts with `itemText`. */
export async function chooseMenuItem(trigger: Element, itemText: string) {
  await act(async () => {
    if (trigger.getAttribute("aria-expanded") === "true") return;
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
    );
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    trigger.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse" }),
    );
    (trigger as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const item = Array.from(
    document.body.querySelectorAll<HTMLElement>(
      '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]',
    ),
  ).find((candidate) => candidate.textContent?.trim().startsWith(itemText));
  if (!item) throw new Error(`Menu item not found: ${itemText}`);
  await act(async () => {
    item.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
