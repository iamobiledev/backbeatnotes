import { ImageResponse } from "next/og";
import { brand } from "@/config/brand";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: brand.themeColor,
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <svg
          width="132"
          height="64"
          viewBox="0 0 132 64"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4 34h25l14-27 24 51 16-38 10 14h35"
            fill="none"
            stroke="white"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    size,
  );
}
