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
 * StatCounterScene — Animated number counter with circular progress arc.
 *
 * Expected contentData: { value, unit, label }
 */
export const StatCounterScene = ({ scene, index, overlapFrames = 0 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const data = scene.contentData || {};
  const targetValue = Number(data.value) || 0;
  const unit = data.unit || "%";
  const label = data.label || scene.bulletPoints?.[0] || "";

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
  const scale = interpolate(entrance, [0, 1], [0.96, 1]);

  // ── counter animation (0 → value over ~1.5s after entrance) ──
  const counterStart = overlapFrames + 12;
  const counterEnd = counterStart + Math.floor(fps * 1.5);
  const currentValue = interpolate(frame, [counterStart, counterEnd], [0, targetValue], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // ── arc progress (SVG circle) ──
  const radius = 130;
  const circumference = 2 * Math.PI * radius;
  const arcFraction = unit.includes("%")
    ? Math.min(targetValue / 100, 1)
    : Math.min(targetValue / Math.max(targetValue, 100), 1);
  const arcProgress = interpolate(frame, [counterStart, counterEnd], [0, arcFraction], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const dashOffset = circumference * (1 - arcProgress);

  // ── pulse glow ──
  const pulseScale = 1 + 0.03 * Math.sin(frame / 8);

  // Display value formatting
  const displayValue = targetValue === Math.floor(targetValue)
    ? Math.round(currentValue)
    : currentValue.toFixed(1);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "90px 120px",
        opacity,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `scale(${scale})`,
        }}
      >
        {/* Badge */}
        <span
          style={{
            display: "inline-block",
            padding: "6px 14px",
            borderRadius: 999,
            background: "rgba(139,92,246,0.22)",
            color: "#ddd6fe",
            fontSize: 17,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            marginBottom: 12,
          }}
        >
          Scene {index + 1}
        </span>

        <KineticText
          text={scene.title || "By the Numbers"}
          fontSize={44}
          fontWeight={800}
          delayFrames={3}
          gradient
        />

        {/* Counter circle */}
        <div
          style={{
            position: "relative",
            width: 320,
            height: 320,
            marginTop: 40,
            transform: `scale(${pulseScale})`,
          }}
        >
          <svg
            viewBox="0 0 320 320"
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
          >
            {/* Track */}
            <circle
              cx="160"
              cy="160"
              r={radius}
              fill="none"
              stroke="rgba(139,92,246,0.15)"
              strokeWidth="10"
            />
            {/* Progress arc */}
            <circle
              cx="160"
              cy="160"
              r={radius}
              fill="none"
              stroke="url(#arcGrad)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 160 160)"
              style={{ filter: "drop-shadow(0 0 10px rgba(167,139,250,0.45))" }}
            />
            <defs>
              <linearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#c084fc" />
              </linearGradient>
            </defs>
          </svg>
          {/* Number */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontSize: 72,
                fontWeight: 900,
                color: "#f8fafc",
                textShadow: "0 4px 30px rgba(167,139,250,0.35)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {displayValue}
              <span style={{ fontSize: 36, fontWeight: 600, color: "#c4b5fd" }}>
                {unit}
              </span>
            </span>
          </div>
        </div>

        {/* Label */}
        {label && (
          <div
            style={{
              marginTop: 28,
              maxWidth: 800,
              textAlign: "center",
              fontSize: 28,
              fontWeight: 560,
              color: "#e2e8f0",
              lineHeight: 1.28,
              opacity: interpolate(frame, [counterEnd - 6, counterEnd + 6], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            {label}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
