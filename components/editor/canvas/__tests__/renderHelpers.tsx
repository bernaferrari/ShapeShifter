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
