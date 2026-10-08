import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
const icon = await readFile(join(process.cwd(), "app/icon.svg"), "base64");

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#1496ff" }}>
      <img src={`data:image/svg+xml;base64,${icon}`} width={180} height={180} alt="" />
    </div>,
    size,
  );
}
