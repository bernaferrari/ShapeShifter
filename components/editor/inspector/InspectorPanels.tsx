"use client";

import React from "react";
import { Copy, Ellipsis, Link2, RotateCw, Scaling, Trash2, Unlink2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getPathDataBounds } from "@/lib/shapeshifter/path/pathDataIO";
import { useEditorStore } from "@/lib/store/editorStore";
import type { CanvasFrame } from "@/lib/store/editorStore";
import type { Layer } from "@/lib/shapeshifter/types";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { timelinePropertiesForLayer } from "@/lib/shapeshifter/motion/timelineProperties";
import {
  sharedValue,
  type InspectorSelectionBounds,
} from "@/lib/shapeshifter/scene/inspectorSelection";
import {
  KeyframeToggle,
  KeyframeMenu,
  KeyframeMenuItems,
  KeyframeSlot,
  NumberRow,
  Row,
  Section,
  TextInput,
  type KeyframeToggleProps,
} from "./InspectorControls";
import { parsePath, pathToString } from "@/lib/shapeshifter/pathUtils";
import { pathDAtTime } from "@/lib/shapeshifter/playheadResolve";
import { sameKeyframeTime } from "@/lib/shapeshifter/motion/timelineKeyframes";
import { useTimelineViewSettings } from "../timeline/timelineViewSettings";
import { formatTimelineTime } from "../timeline/timelineScale";
import { scalePathToBounds } from "@/lib/shapeshifter/path/pathEditing";

/**
 * Resolves the inline ◇ toggle for a property. Only properties the layer type can
 * actually animate (and export) get one, so the inspector never offers a dead end.
 */
export function useKeyframeToggles(layer: Layer, count: number) {
  const blocks = useEditorStore((state) => state.animation.blocks);
  const progress = useEditorStore((state) => (state.isPlaying ? null : state.progress));
  const duration = useEditorStore((state) => state.animation.duration);
  const timeUnit = useTimelineViewSettings((state) => state.unit);
  const fps = useTimelineViewSettings((state) => state.fps);
  const time = (progress ?? useEditorStore.getState().progress) * duration;
  const animatable = React.useMemo(
    () => new Set(timelinePropertiesForLayer(layer.type)),
    [layer.type],
  );
  /** One ◇ for a property, or for a pair animated together (Position, Scale). */
  return (property: string | string[], groupLabel?: string): KeyframeToggleProps | undefined => {
    const properties = Array.isArray(property) ? property : [property];
    if (count > 1 || layer.locked || !properties.every((name) => animatable.has(name as never)))
      return undefined;
    const animated = properties.filter((name) =>
      blocks.some(
        (block) => String(block.layerId) === String(layer.id) && block.propertyName === name,
      ),
    );
    const trackBlocks = blocks.filter(
      (block) =>
        String(block.layerId) === String(layer.id) && properties.includes(block.propertyName),
    );
    const atPlayhead = (block: (typeof blocks)[number]) =>
      sameKeyframeTime(block.startTime, time) || sameKeyframeTime(block.endTime, time);
    const active = properties.every((name) =>
      trackBlocks.some((block) => block.propertyName === name && atPlayhead(block)),
    );
    const label = groupLabel ?? propertyLabel(properties[0]!);
    const transaction = (action: () => void) => {
      const store = useEditorStore.getState();
      store.beginHistoryGesture();
      try {
        action();
      } finally {
        useEditorStore.getState().endHistoryGesture();
      }
    };
    return {
      active,
      animated: animated.length > 0,
      label: !animated.length
        ? `Animate ${label}`
        : active
          ? `Select ${label} keyframe`
          : `Add ${label} keyframe at ${formatTimelineTime(time, timeUnit, fps)}`,
      onClick: () =>
        transaction(() => {
          for (const name of properties)
            useEditorStore.getState().addKeyframeAtPlayhead(layer.id, name);
        }),
      removeAnimation: animated.length
        ? () =>
            transaction(() => {
              for (const name of animated)
                useEditorStore.getState().removeTimelineProperty(layer.id, name);
            })
        : undefined,
      removeAnimationLabel: `Remove ${label} animation`,
      removeKeyframe:
        active &&
        properties.every((name) =>
          trackBlocks.some(
            (block) => block.propertyName === name && block.startTime !== block.endTime,
          ),
        )
          ? () =>
              transaction(() => {
                for (const name of properties) {
                  const block = useEditorStore
                    .getState()
                    .animation.blocks.find(
                      (block) =>
                        String(block.layerId) === String(layer.id) &&
                        block.propertyName === name &&
                        atPlayhead(block),
                    );
                  if (block)
                    useEditorStore
                      .getState()
                      .removeTimelineKeyframe(
                        block.id,
                        sameKeyframeTime(block.startTime, time) ? "start" : "end",
                      );
                }
              })
          : undefined,
      removeKeyframeLabel: `Remove ${label} keyframe`,
    };
  };
}

export function LayerTransformSection({
  layer,
  selectedLayers,
  bounds,
  count,
  onPatch,
  onTranslate,
  size,
}: {
  layer: Layer;
  selectedLayers: Layer[];
  bounds: InspectorSelectionBounds | null;
  count: number;
  onPatch: (patch: Partial<Layer>) => void;
  onTranslate: (dx: number, dy: number) => void;
  /** Geometry W/H, shown under position like Figma's design panel. */
  size?: Omit<React.ComponentProps<typeof LayerSizeRow>, "count" | "linked">;
}) {
  const scaleX = sharedValue(selectedLayers, (item) => item.scaleX ?? 1, layer.scaleX ?? 1);
  const scaleY = sharedValue(selectedLayers, (item) => item.scaleY ?? 1, layer.scaleY ?? 1);
  const rotation = sharedValue(selectedLayers, (item) => item.rotation ?? 0, layer.rotation ?? 0);
  const positionX = bounds?.x ?? layer.translateX ?? 0;
  const positionY = bounds?.y ?? layer.translateY ?? 0;
  const keyframeFor = useKeyframeToggles(layer, count);
  const [scaleLinked, setScaleLinked] = React.useState(
    () => !scaleX.mixed && !scaleY.mixed && Math.abs(scaleX.value - scaleY.value) < 1e-6,
  );
  React.useEffect(() => {
    if (scaleX.mixed || scaleY.mixed) setScaleLinked(false);
  }, [layer.id, scaleX.mixed, scaleY.mixed]);

  const patchScale = (axis: "x" | "y", percent: number) => {
    const value = percent / 100;
    if (!scaleLinked) {
      onPatch(axis === "x" ? { scaleX: value } : { scaleY: value });
      return;
    }
    const current = axis === "x" ? scaleX.value : scaleY.value;
    const other = axis === "x" ? scaleY.value : scaleX.value;
    const linkedValue = Math.abs(current) > 1e-6 ? other * (value / current) : value;
    onPatch(
      axis === "x"
        ? { scaleX: value, scaleY: linkedValue }
        : { scaleX: linkedValue, scaleY: value },
    );
  };
  const clipOnly = layer.type === "clipPath";
  const showKeyframes = count === 1;
  const blocks = useEditorStore((state) => state.animation.blocks);
  const animated = (...names: string[]) =>
    blocks.some(
      (block) => String(block.layerId) === String(layer.id) && names.includes(block.propertyName),
    );
  // Progressive disclosure: scale and the rotation center appear when used or asked for.
  const [revealed, setRevealed] = React.useState<{ scale: boolean; center: boolean }>({
    scale: false,
    center: false,
  });
  React.useEffect(() => setRevealed({ scale: false, center: false }), [layer.id]);
  const showScale =
    !clipOnly &&
    (revealed.scale ||
      scaleX.mixed ||
      scaleY.mixed ||
      Math.abs(scaleX.value - 1) > 1e-6 ||
      Math.abs(scaleY.value - 1) > 1e-6 ||
      animated("scaleX", "scaleY"));
  const showCenter =
    count === 1 &&
    !clipOnly &&
    (revealed.center ||
      layer.type === "group" ||
      (layer.pivotX ?? 0) !== 0 ||
      (layer.pivotY ?? 0) !== 0 ||
      animated("pivotX", "pivotY"));

  const transformKeyframes = [
    keyframeFor(["translateX", "translateY"], "Position"),
    keyframeFor("pathData", "Path"),
    keyframeFor("rotation"),
    keyframeFor(["scaleX", "scaleY"], "Scale"),
    keyframeFor(["pivotX", "pivotY"], "Rotation center"),
  ];

  return (
    <Section
      title="Transform"
      action={
        clipOnly ? (
          <KeyframeMenu label="Transform" keyframes={transformKeyframes} />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setScaleLinked((linked) => !linked)}
              className={cn(
                "grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                scaleLinked && "text-foreground",
              )}
              aria-label="Lock proportions"
              aria-pressed={scaleLinked}
              title={scaleLinked ? "Proportions locked" : "Proportions unlocked"}
            >
              {scaleLinked ? <Link2 className="size-3.5" /> : <Unlink2 className="size-3.5" />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="More transform options"
                    className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted"
                  />
                }
              >
                <Ellipsis className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuCheckboxItem
                  checked={showScale}
                  disabled={showScale && !revealed.scale}
                  onCheckedChange={(checked) =>
                    setRevealed((value) => ({ ...value, scale: Boolean(checked) }))
                  }
                >
                  Scale
                </DropdownMenuCheckboxItem>
                {count === 1 && (
                  <DropdownMenuCheckboxItem
                    checked={showCenter}
                    disabled={showCenter && !revealed.center}
                    onCheckedChange={(checked) =>
                      setRevealed((value) => ({ ...value, center: Boolean(checked) }))
                    }
                  >
                    Rotation center
                  </DropdownMenuCheckboxItem>
                )}
                {transformKeyframes.some((keyframe) => keyframe?.removeAnimation) && (
                  <>
                    <DropdownMenuSeparator />
                    <KeyframeMenuItems keyframes={transformKeyframes} />
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )
      }
    >
      <PairRow
        keyframe={keyframeFor(["translateX", "translateY"], "Position")}
        reserve={showKeyframes}
      >
        <NumberRow
          label="X"
          compact
          value={positionX}
          onChange={(value) => onTranslate(value - positionX, 0)}
        />
        <NumberRow
          label="Y"
          compact
          value={positionY}
          onChange={(value) => onTranslate(0, value - positionY)}
        />
      </PairRow>
      {size && <LayerSizeRow {...size} count={count} linked={scaleLinked} />}
      {!clipOnly && (
        // Half-width fields share the pair grid, so their diamond lines up too.
        <PairRow keyframe={keyframeFor("rotation")} reserve={showKeyframes}>
          <NumberRow
            label="Rotation"
            glyph={<RotateCw className="size-3" />}
            compact
            value={Math.round(rotation.value * 100) / 100}
            mixed={rotation.mixed}
            suffix="°"
            onChange={(value) => onPatch({ rotation: value })}
          />
          <span aria-hidden />
        </PairRow>
      )}
      {showScale && scaleLinked && (
        <PairRow keyframe={keyframeFor(["scaleX", "scaleY"], "Scale")} reserve={showKeyframes}>
          <NumberRow
            label="Scale"
            glyph={<Scaling className="size-3" />}
            compact
            value={Math.round(scaleX.value * 10000) / 100}
            mixed={scaleX.mixed}
            step={1}
            suffix="%"
            onChange={(value) => onPatch({ scaleX: value / 100, scaleY: value / 100 })}
          />
          <span aria-hidden />
        </PairRow>
      )}
      {showScale && !scaleLinked && (
        <PairRow keyframe={keyframeFor(["scaleX", "scaleY"], "Scale")} reserve={showKeyframes}>
          <NumberRow
            label="Scale X"
            glyph={<span className="text-[10px]">SX</span>}
            compact
            value={Math.round(scaleX.value * 10000) / 100}
            mixed={scaleX.mixed}
            step={1}
            suffix="%"
            onChange={(value) => patchScale("x", value)}
          />
          <NumberRow
            label="Scale Y"
            glyph={<span className="text-[10px]">SY</span>}
            compact
            value={Math.round(scaleY.value * 10000) / 100}
            mixed={scaleY.mixed}
            step={1}
            suffix="%"
            onChange={(value) => patchScale("y", value)}
          />
        </PairRow>
      )}
      {showCenter && (
        <div className="space-y-1">
          <div
            className="text-[11px] text-muted-foreground"
            title="The point rotation and scale happen around"
          >
            Rotation center
          </div>
          <PairRow keyframe={keyframeFor(["pivotX", "pivotY"], "Rotation center")} reserve>
            <NumberRow
              label="Center X"
              glyph="X"
              compact
              value={layer.pivotX ?? 0}
              onChange={(value) => onPatch({ pivotX: value })}
            />
            <NumberRow
              label="Center Y"
              glyph="Y"
              compact
              value={layer.pivotY ?? 0}
              onChange={(value) => onPatch({ pivotY: value })}
            />
          </PairRow>
        </div>
      )}
    </Section>
  );
}

/** Two fields sharing one ◇ — the pair animates together (Position, Scale, Size). */
export function PairRow({
  children,
  keyframe,
  reserve = false,
}: {
  children: React.ReactNode;
  keyframe?: KeyframeToggleProps;
  reserve?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5">
      {children}
      {keyframe ? <KeyframeToggle keyframe={keyframe} /> : reserve && <KeyframeSlot />}
    </div>
  );
}

/** Geometry size. Animating it keys the path shape, so W/H share the Path ◇. */
export function LayerSizeRow({
  layer,
  selectedLayers,
  bounds,
  count,
  progressMs,
  linked,
}: {
  layer: Layer;
  selectedLayers: Layer[];
  bounds: InspectorSelectionBounds | null;
  count: number;
  progressMs: number;
  /** Proportions lock shared with scale. */
  linked: boolean;
}) {
  const blocks = useEditorStore((state) => state.animation.blocks);
  const duration = useEditorStore((state) => state.animation.duration);
  const keyframeFor = useKeyframeToggles(layer, count);
  const animated =
    count === 1 &&
    blocks.some(
      (block) => String(block.layerId) === String(layer.id) && block.propertyName === "pathData",
    );
  const geometry = React.useMemo(() => {
    if (bounds?.coordinateSpace === "world") return null;
    const paths = selectedLayers.filter((item) => item.type !== "group");
    if (!paths.length || paths.length !== selectedLayers.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of paths) {
      const source = animated
        ? parsePath(pathDAtTime(item, blocks, progressMs, duration, progressMs / duration))
        : item.from;
      const box = getPathDataBounds(source);
      if (!box) continue;
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.w);
      maxY = Math.max(maxY, box.y + box.h);
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [animated, blocks, bounds?.coordinateSpace, duration, progressMs, selectedLayers]);
  if (!geometry || layer.locked) return null;

  const resize = (axis: "width" | "height", value: number) => {
    if (value <= 0) return;
    const ratio = geometry.width / Math.max(1e-6, geometry.height);
    const width = axis === "width" ? value : linked ? value * ratio : geometry.width;
    const height = axis === "height" ? value : linked ? value / ratio : geometry.height;
    const target = { ...geometry, width, height };
    const store = useEditorStore.getState();
    if (animated) {
      // Animated shape: write the resized shape at the playhead.
      const current = parsePath(
        pathDAtTime(layer, store.animation.blocks, progressMs, duration, progressMs / duration),
      );
      store.setPropertiesAtPlayhead(layer.id, {
        pathData: pathToString(scalePathToBounds(current, geometry, target)),
      });
      return;
    }
    store.resizeSelectedLayer(geometry, target);
  };
  const round = (value: number) => Math.round(value * 100) / 100;

  return (
    <PairRow keyframe={keyframeFor("pathData", "Path")} reserve={count === 1}>
      <NumberRow
        label="W"
        compact
        value={round(geometry.width)}
        min={0.01}
        step={0.1}
        onChange={(value) => resize("width", value)}
      />
      <NumberRow
        label="H"
        compact
        value={round(geometry.height)}
        min={0.01}
        step={0.1}
        onChange={(value) => resize("height", value)}
      />
    </PairRow>
  );
}

export function FrameDesignPanel({
  frame,
  selectedFrames,
  onRename,
  onMove,
  onResize,
  onDuplicate,
  onDelete,
  canDelete,
}: {
  frame: CanvasFrame;
  selectedFrames: CanvasFrame[];
  onRename: (name: string) => void;
  onMove: (dx: number, dy: number) => void;
  onResize: (width: number, height: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const count = selectedFrames.length;
  const selectionX = Math.min(...selectedFrames.map((item) => item.x));
  const selectionY = Math.min(...selectedFrames.map((item) => item.y));
  const widthValues = selectedFrames.map((item) => item.vector.width);
  const heightValues = selectedFrames.map((item) => item.vector.height);
  const [nameDraft, setNameDraft] = React.useState(frame.name);
  React.useEffect(() => setNameDraft(frame.name), [frame.id, frame.name]);

  return (
    <>
      <Section
        title="Frame"
        action={
          count === 1 ? (
            <>
              <button
                type="button"
                onClick={onDuplicate}
                className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Duplicate frame"
                title="Duplicate frame"
              >
                <Copy className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={!canDelete}
                className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                aria-label="Delete frame"
                title="Delete frame"
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          ) : undefined
        }
      >
        {count === 1 && (
          <Row label="Name">
            <TextInput
              value={nameDraft}
              onChange={setNameDraft}
              onBlur={() => onRename(nameDraft)}
              ariaLabel="Frame name"
            />
          </Row>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <NumberRow
            label="X"
            compact
            value={selectionX}
            onChange={(value) => onMove(value - selectionX, 0)}
          />
          <NumberRow
            label="Y"
            compact
            value={selectionY}
            onChange={(value) => onMove(0, value - selectionY)}
          />
          {count === 1 ? (
            <>
              <NumberRow
                label="W"
                compact
                value={frame.vector.width}
                min={1}
                onChange={(value) => onResize(value, frame.vector.height)}
              />
              <NumberRow
                label="H"
                compact
                value={frame.vector.height}
                min={1}
                onChange={(value) => onResize(frame.vector.width, value)}
              />
            </>
          ) : (
            <>
              <MixedReadout label="W" values={widthValues} />
              <MixedReadout label="H" values={heightValues} />
            </>
          )}
        </div>
      </Section>
      {count === 1 && (
        <Section title="Android" defaultOpen={false}>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberRow
              label="VW"
              compact
              value={frame.vector.viewportWidth ?? frame.vector.width}
              min={1}
              onChange={(value) => useEditorStore.getState().updateVector({ viewportWidth: value })}
            />
            <NumberRow
              label="VH"
              compact
              value={frame.vector.viewportHeight ?? frame.vector.height}
              min={1}
              onChange={(value) =>
                useEditorStore.getState().updateVector({ viewportHeight: value })
              }
            />
          </div>
          <Row label="Tint">
            <TextInput
              ariaLabel="Android tint"
              value={frame.vector.tint ?? ""}
              placeholder="None"
              onChange={(value) =>
                useEditorStore.getState().updateVector({ tint: value || undefined })
              }
            />
          </Row>
          <Row label="Tint mode">
            <TextInput
              ariaLabel="Android tint mode"
              value={frame.vector.tintMode ?? ""}
              placeholder="src_in"
              onChange={(value) =>
                useEditorStore.getState().updateVector({ tintMode: value || undefined })
              }
            />
          </Row>
          <label className="flex h-7 items-center justify-between text-[11px] text-muted-foreground">
            Auto-mirror in RTL
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={Boolean(frame.vector.autoMirrored)}
              onChange={() =>
                useEditorStore.getState().updateVector({ autoMirrored: !frame.vector.autoMirrored })
              }
            />
          </label>
        </Section>
      )}
    </>
  );
}

function MixedReadout({ label, values }: { label: string; values: number[] }) {
  const mixed = values.some((value) => value !== values[0]);
  return (
    <div className="flex h-7 items-center gap-2 rounded-md bg-secondary/60 px-2 text-[11px]">
      <span className="w-3 text-muted-foreground">{label}</span>
      <span className="text-muted-foreground">{mixed ? "Mixed" : values[0]}</span>
    </div>
  );
}
