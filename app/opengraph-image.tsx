import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt =
  "Pathshift — Android vector animation editor. Actual workspace showing a play-to-pause icon, editable path points, inspector, and animation timeline.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
const icon = await readFile(join(process.cwd(), "app/icon.svg"), "base64");
const editor = await readFile(join(process.cwd(), "docs/pathshift-social-editor.jpg"), "base64");

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "#101113",
        color: "#f5f5f5",
        padding: "32px 40px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 92,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, height: 64 }}>
            <img src={`data:image/svg+xml;base64,${icon}`} width={52} height={52} alt="" />
            <span style={{ fontSize: 64, lineHeight: 1, fontWeight: 700, letterSpacing: -3 }}>
              Pathshift
            </span>
          </div>
          <div style={{ display: "flex", marginTop: 6, fontSize: 22, color: "#a6a9b0" }}>
            Android vector animation, in your browser.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 6,
            fontSize: 18,
          }}
        >
          <span style={{ color: "#a6a9b0" }}>VectorDrawable</span>
          <span style={{ color: "#55b4ff" }}>AnimatedVectorDrawable</span>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexShrink: 0,
          marginTop: 22,
          width: 1120,
          height: 464,
          overflow: "hidden",
          borderRadius: 12,
          border: "1px solid #393b40",
        }}
      >
        <img src={`data:image/jpeg;base64,${editor}`} width={1120} height={464} alt="" />
      </div>
    </div>,
    size,
  );
}
