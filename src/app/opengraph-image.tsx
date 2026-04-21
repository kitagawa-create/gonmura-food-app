import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Gonmura Food";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #0f3460 100%)",
        }}
      >
        <div style={{ fontSize: 160, lineHeight: 1, marginBottom: 32 }}>🍜</div>
        <div
          style={{
            fontSize: 80,
            fontWeight: "bold",
            color: "#ffffff",
            letterSpacing: "-2px",
            marginBottom: 16,
          }}
        >
          Gonmura Food
        </div>
        <div style={{ fontSize: 36, color: "#93c5fd" }}>
          本格家系ラーメン モバイルオーダー
        </div>
      </div>
    ),
    { ...size }
  );
}
