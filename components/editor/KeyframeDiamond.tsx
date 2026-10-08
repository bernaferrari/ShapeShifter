import { cn } from "@/lib/utils";

/** Filled means a pose exists here; selection uses an independent outline. */
export function KeyframeDiamond({
  active,
  selected,
  animated = true,
  size = 7,
  className,
}: {
  active?: boolean;
  selected?: boolean;
  animated?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none block shrink-0 rotate-45 rounded-[0.5px] border border-solid transition-colors",
        active ? "bg-primary" : "bg-background",
        selected && "outline outline-2 outline-offset-2 outline-foreground",
        className,
      )}
      style={{
        width: size,
        height: size,
        boxSizing: "border-box",
        borderWidth: 1.25,
        borderColor: active || animated ? "var(--primary)" : "var(--muted-foreground)",
        transformOrigin: "center center",
      }}
    />
  );
}
