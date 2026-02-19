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
 * DefinitionScene — Dictionary-style term highlight card.
 *
 * Expected contentData: { term, definition }
 */
export const DefinitionScene = ({ scene, index, overlapFrames = 0 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const data = scene.contentData || {};
  const term = data.term || scene.title || "";
  const definition = data.definition || scene.bulletPoints?.[0] || "";

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
  const fadeIn = overlapFrames > 0
    ? interpolate(frame, [0, overlapFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;
  const opacity = fadeIn * fadeOut;
  const y = interpolate(entrance, [0, 1], [40, 0]);
  const scale = interpolate(entrance, [0, 1], [0.95, 1]);

  // ── underline sweep under term ──
  const sweepEnd = Math.floor(fps * 0.8);
  const underlineWidth = interpolate(frame - overlapFrames, [8, sweepEnd], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ── definition text fade-in ──
  const defOpacity = interpolate(frame - overlapFrames, [sweepEnd, sweepEnd + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const defY = interpolate(frame - overlapFrames, [sweepEnd, sweepEnd + 12], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "90px 160px",
        opacity,
        filter: `blur(${interpolate(frame, [exitStart, durationInFrames], [0, 4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1300,
          borderRadius: 40,
          padding: "64px 72px",
          border: "1px solid rgba(56,189,248,0.25)",
          background:
            "linear-gradient(165deg, rgba(2,6,23,0.88), rgba(8,47,73,0.70) 55%, rgba(12,74,110,0.50))",
          boxShadow: "0 30px 90px rgba(56,189,248,0.18)",
          transform: `translateY(${y}px) scale(${scale})`,
        }}
      >
        {/* Badge */}
        <span
          style={{
            display: "inline-block",
            padding: "6px 14px",
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

        {/* Eyebrow */}
        <div
          style={{
            marginTop: 20,
            fontSize: 18,
            fontWeight: 600,
            color: "#7dd3fc",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          Definition
        </div>

        {/* Term with underline */}
        <div style={{ marginTop: 16, position: "relative", display: "inline-block" }}>
          <KineticText
            text={term}
            fontSize={56}
            fontWeight={900}
            color="#f8fafc"
            delayFrames={3}
            emphasizeFirst
          />
          <div
            style={{
              position: "absolute",
              bottom: -6,
              left: 0,
              height: 4,
              width: `${underlineWidth}%`,
              borderRadius: 2,
              background: "linear-gradient(90deg, #38bdf8, #7dd3fc, transparent)",
              boxShadow: "0 0 14px rgba(56,189,248,0.40)",
            }}
          />
        </div>

        {/* Definition text */}
        <div
          style={{
            marginTop: 36,
            fontSize: 30,
            fontWeight: 520,
            color: "#cbd5e1",
            lineHeight: 1.36,
            maxWidth: 1100,
            opacity: defOpacity,
            transform: `translateY(${defY}px)`,
          }}
        >
          {definition}
        </div>

        {/* Additional bullets if present */}
        {scene.bulletPoints && scene.bulletPoints.length > 1 && (
          <div style={{ marginTop: 24, display: "grid", gap: 12 }}>
            {scene.bulletPoints.slice(1).map((b, idx) => {
              const bFrame = frame - overlapFrames - sweepEnd - 6 - idx * 6;
              const bEntrance = spring({
                frame: Math.max(0, bFrame),
                fps,
                config: { damping: 12, stiffness: 90, mass: 0.6 },
              });
              const bOpacity = bFrame < 0 ? 0 : interpolate(bEntrance, [0, 1], [0, 1]);
              const bX = interpolate(bEntrance, [0, 1], [40, 0]);
              return (
                <div
                  key={idx}
                  style={{
                    fontSize: 26,
                    fontWeight: 500,
                    color: "#94a3b8",
                    lineHeight: 1.28,
                    opacity: bOpacity,
                    transform: `translateX(${bFrame < 0 ? 40 : bX}px)`,
                  }}
                >
                  <span style={{ color: "#7dd3fc", marginRight: 10 }}>-</span>
                  {b}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
