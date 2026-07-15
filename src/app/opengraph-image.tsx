import { ImageResponse } from "next/og";
import { brand } from "@/config/brand";

export const alt = `${brand.name} — ${brand.tagline}`;

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "linear-gradient(135deg, #f7fbff 0%, #e7f3f8 100%)",
          color: "#37352f",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          padding: 64,
          width: "100%",
        }}
      >
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #d9e7f3",
            borderRadius: 32,
            boxShadow: "0 24px 80px rgba(35, 131, 226, 0.14)",
            display: "flex",
            flexDirection: "column",
            height: "100%",
            justifyContent: "space-between",
            padding: "58px 64px",
            width: "100%",
          }}
        >
          <div style={{ alignItems: "center", display: "flex", gap: 22 }}>
            <div
              style={{
                alignItems: "center",
                background: brand.themeColor,
                borderRadius: 18,
                display: "flex",
                height: 76,
                justifyContent: "center",
                width: 76,
              }}
            >
              <svg width="58" height="32" viewBox="0 0 58 32">
                <path
                  d="M2 17h11l6-13 11 25 7-18 5 6h14"
                  fill="none"
                  stroke="white"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span style={{ fontSize: 44, fontWeight: 750, letterSpacing: -1.5 }}>
              {brand.name}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div
              style={{
                fontSize: 70,
                fontWeight: 750,
                letterSpacing: -3,
                lineHeight: 1.05,
                maxWidth: 880,
              }}
            >
              {brand.socialTitle}
            </div>
            <div style={{ color: "#5f5e59", fontSize: 28, lineHeight: 1.35 }}>
              Collaborative docs, wikis, decisions, and playbooks in one
              searchable workspace.
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
