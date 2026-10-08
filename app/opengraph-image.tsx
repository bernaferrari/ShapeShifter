import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt =
  "Pathshift — Android icons. Made to move. VectorDrawable and AnimatedVectorDrawable editor, illustrated with an icon morph and keyframes on an Android phone.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
const icon = await readFile(join(process.cwd(), "app/icon.svg"), "base64");
const illustration = await readFile(join(process.cwd(), "app/social-preview.svg"), "base64");

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        position: "relative",
        width: "100%",
        height: "100%",
        background: "radial-gradient(ellipse at 85% 40%, #193c30 0%, #111a19 40%, #101415 75%)",
        color: "#f5f5f5",
        padding: "52px 60px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: 640 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <img src={`data:image/svg+xml;base64,${icon}`} width={52} height={52} alt="" />
          <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>Pathshift</span>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 64,
            fontSize: 18,
            letterSpacing: 3,
            color: "#80edab",
          }}
        >
          ANDROID VECTOR ANIMATION
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 21,
            fontSize: 78,
            lineHeight: 1.08,
            letterSpacing: -4,
            fontWeight: 700,
          }}
        >
          <span>Android icons.</span>
          <span style={{ color: "#80edab" }}>Made to move.</span>
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 25, color: "#aebcb5" }}>
          Draw. Morph. Export Android XML.
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 52,
            fontSize: 18,
            color: "#c4d6cb",
          }}
        >
          {["VectorDrawable", "AnimatedVectorDrawable"].map((format) => (
            <div
              key={format}
              style={{
                display: "flex",
                padding: "12px 16px",
                border: "1px solid #30443b",
                borderRadius: 10,
                background: "#15221c",
              }}
            >
              {format}
            </div>
          ))}
        </div>
      </div>
      <img
        src={`data:image/svg+xml;base64,${illustration}`}
        width={480}
        height={520}
        alt=""
        style={{ position: "absolute", right: 12, top: 54 }}
      />
      <div
        style={{
          display: "flex",
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 4,
          background: "linear-gradient(90deg, #1496ff, #80edab)",
        }}
      />
    </div>,
    size,
  );
}
