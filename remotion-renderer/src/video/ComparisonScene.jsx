import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { KineticText } from "./KineticText";

/**
 * ComparisonScene — Split-screen contrast cards sliding from opposite edges.
 *
 * Expected contentData: { left, right, leftLabel, rightLabel }
 */
export const ComparisonScene = ({ scene, index, overlapFrames = 0 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const data = scene.contentData || {};

  // ── entrance / exit ──
  const entrance = spring({
    frame: Math.max(0, frame - overlapFrames),
    fps,
    config: { damping: 14, stiffness: 100, mass: 0.8 },
  });
  const exitStart = durationInFrames - 18;
  const fadeOut = interpolate(frame, [exitStart, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });
  const fadeIn =
    overlapFrames > 0
      ? interpolate(frame, [0, overlapFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  const opacity = fadeIn * fadeOut;
  const scale = interpolate(entrance, [0, 1], [0.96, 1]);

  // ── left card slides from left ──
  const leftX = interpolate(
    spring({ frame: Math.max(0, frame - overlapFrames - 2), fps, config: { damping: 13, stiffness: 80, mass: 0.7 } }),
    [0, 1],
    [-320, 0]
  );
  // ── right card slides from right ──
  const rightX = interpolate(
    spring({ frame: Math.max(0, frame - overlapFrames - 8), fps, config: { damping: 13, stiffness: 80, mass: 0.7 } }),
    [0, 1],
    [320, 0]
  );

  const cardStyle = (bg, border) => ({
    flex: 1,
    padding: "40px 36px",
    borderRadius: 28,
    border: `1px solid ${border}`,
    background: bg,
    color: "#f1f5f9",
    fontSize: 28,
    fontWeight: 540,
    lineHeight: 1.32,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "80px 120px",
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div style={{ width: "100%", maxWidth: 1500, textAlign: "center" }}>
        <div style={{ marginBottom: 12 }}>
          <span
            style={{
              display: "inline-block",
              padding: "6px 16px",
              borderRadius: 999,
              background: "rgba(56,189,248,0.18)",
              color: "#dbeafe",
              fontSize: 17,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            Scene {index + 1}
          </span>
        </div>
        <KineticText
          text={scene.title || "Head to Head"}
          fontSize={48}
          fontWeight={800}
          delayFrames={3}
          gradient
        />
      </div>

      {/* Split cards */}
      <div
        style={{
          display: "flex",
          gap: 28,
          width: "100%",
          maxWidth: 1500,
          marginTop: 36,
        }}
      >
        {/* Left card */}
        <div
          style={{
            ...cardStyle(
              "linear-gradient(165deg, rgba(6,78,59,0.65), rgba(4,47,46,0.45))",
              "rgba(52,211,153,0.30)"
            ),
            transform: `translateX(${leftX}px)`,
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "#6ee7b7",
            }}
          >
            {data.leftLabel || "A"}
          </div>
          <div>{data.left || scene.bulletPoints?.[0] || ""}</div>
        </div>

        {/* VS divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: 80,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(248,113,113,0.40), rgba(239,68,68,0.12))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
              fontWeight: 900,
              color: "#fca5a5",
              boxShadow: "0 0 30px rgba(239,68,68,0.25)",
              transform: `scale(${interpolate(
                spring({
                  frame: Math.max(0, frame - overlapFrames - 14),
                  fps,
                  config: { damping: 8, stiffness: 200, mass: 0.4 },
                }),
                [0, 1],
                [0, 1]
              )})`,
            }}
          >
            VS
          </div>
        </div>

        {/* Right card */}
        <div
          style={{
            ...cardStyle(
              "linear-gradient(165deg, rgba(30,58,138,0.65), rgba(23,37,84,0.45))",
              "rgba(96,165,250,0.30)"
            ),
            transform: `translateX(${rightX}px)`,
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "#93c5fd",
            }}
          >
            {data.rightLabel || "B"}
          </div>
          <div>{data.right || scene.bulletPoints?.[1] || ""}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
