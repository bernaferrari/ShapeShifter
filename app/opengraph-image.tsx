import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Pathshift — Draw vectors. Make them move. A vector and motion editor.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
const icon = await readFile(join(process.cwd(), "app/icon.svg"), "base64");
const illustration = await readFile(join(process.cwd(), "docs/pathshift-icon.png"), "base64");

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        position: "relative",
        width: "100%",
        height: "100%",
        background: "#171717",
        color: "#f5f5f5",
        padding: 64,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: 690 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <img src={`data:image/svg+xml;base64,${icon}`} width={52} height={52} alt="" />
          <span style={{ fontSize: 38, fontWeight: 700, letterSpacing: -1 }}>Pathshift</span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 88,
            fontSize: 72,
            lineHeight: 1.12,
            letterSpacing: -3,
            fontWeight: 700,
          }}
        >
          <span>Draw vectors.</span>
          <span style={{ color: "#1496ff" }}>Make them move.</span>
        </div>
        <div style={{ display: "flex", marginTop: 42, fontSize: 26, color: "#a3a3a3" }}>
          Vector & motion editor
        </div>
      </div>
      <img
        src={`data:image/png;base64,${illustration}`}
        width={430}
        height={430}
        alt=""
        style={{ position: "absolute", right: 36, top: 116 }}
      />
      <div
        style={{
          display: "flex",
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 5,
          background: "#1496ff",
        }}
      />
    </div>,
    size,
  );
}
