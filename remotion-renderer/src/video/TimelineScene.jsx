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
 * TimelineScene — Horizontal step timeline with animated connectors.
 *
 * Expected contentData: { steps: [{ label, detail }] }
 */
export const TimelineScene = ({ scene, index, overlapFrames = 0 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const data = scene.contentData || {};
  const steps = data.steps || scene.bulletPoints?.map((b) => ({ label: b, detail: "" })) || [];

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
  const y = interpolate(entrance, [0, 1], [34, 0]);
  const scale = interpolate(entrance, [0, 1], [0.96, 1]);

  // ── connector line draw progress (0→100% over first 40% of scene) ──
  const lineEnd = durationInFrames * 0.4;
  const lineProgress = interpolate(frame, [10, lineEnd], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "90px 120px",
        opacity,
        filter: `blur(${interpolate(frame, [exitStart, durationInFrames], [0, 4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1500,
          transform: `translateY(${y}px) scale(${scale})`,
        }}
      >
        {/* Badge + title */}
        <div style={{ marginBottom: 8 }}>
          <span
            style={{
              display: "inline-block",
              padding: "6px 14px",
              borderRadius: 999,
              background: "rgba(6,182,212,0.20)",
              color: "#cffafe",
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
          text={scene.title || "Step by Step"}
          fontSize={48}
          fontWeight={800}
          delayFrames={3}
        />

        {/* Timeline */}
        <div
          style={{
            marginTop: 48,
            position: "relative",
            display: "flex",
            alignItems: "flex-start",
            gap: 0,
          }}
        >
          {/* Connector line */}
          <div
            style={{
              position: "absolute",
              top: 22,
              left: 22,
              right: 22,
              height: 3,
              background: "rgba(34,211,238,0.15)",
              borderRadius: 2,
            }}
          >
            <div
              style={{
                width: `${lineProgress}%`,
                height: "100%",
                borderRadius: 2,
                background: "linear-gradient(90deg, #06b6d4, #22d3ee, transparent)",
                boxShadow: "0 0 14px rgba(34,211,238,0.35)",
              }}
            />
          </div>

          {/* Step nodes */}
          {steps.map((step, idx) => {
            const delay = 8 + idx * 10;
            const stepFrame = frame - delay;
            const nodeEntrance = spring({
              frame: Math.max(0, stepFrame),
              fps,
              config: { damping: 10, stiffness: 120, mass: 0.5 },
            });
            const nodeOpacity = stepFrame < 0 ? 0 : interpolate(nodeEntrance, [0, 1], [0, 1]);
            const nodeScale = interpolate(nodeEntrance, [0, 1], [0.4, 1]);

            return (
              <div
                key={idx}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  opacity: nodeOpacity,
                  transform: `scale(${stepFrame < 0 ? 0.4 : nodeScale})`,
                  zIndex: 2,
                }}
              >
                {/* Dot */}
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #06b6d4, #0891b2)",
                    border: "3px solid rgba(207,250,254,0.40)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    fontWeight: 800,
                    color: "#ecfeff",
                    boxShadow: "0 4px 20px rgba(6,182,212,0.30)",
                  }}
                >
                  {idx + 1}
                </div>
                {/* Label */}
                <div
                  style={{
                    marginTop: 14,
                    textAlign: "center",
                    maxWidth: 240,
                    fontSize: 24,
                    fontWeight: 620,
                    color: "#ecfeff",
                    lineHeight: 1.24,
                  }}
                >
                  {step.label || step}
                </div>
                {step.detail && step.detail !== step.label && (
                  <div
                    style={{
                      marginTop: 6,
                      textAlign: "center",
                      maxWidth: 220,
                      fontSize: 17,
                      fontWeight: 440,
                      color: "#a5f3fc",
                      lineHeight: 1.22,
                    }}
                  >
                    {step.detail.slice(0, 80)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
