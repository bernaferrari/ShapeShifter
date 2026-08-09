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
