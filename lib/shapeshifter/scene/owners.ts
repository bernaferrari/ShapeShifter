/** Stable owner id for vectors placed directly on the infinite page. */
export const PAGE_ROOT_ID = "__page_root__";

/** Document-wide object identity. Layer ids are stable; owner ids preserve scene scope. */
export interface LayerSelectionRef {
  ownerId: string;
  layerId: string | number;
}
