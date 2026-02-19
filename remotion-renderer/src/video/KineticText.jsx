import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * KineticText — Word-by-word animated text reveal with emphasis.
 *
 * Props:
 *   text        – The string to animate
 *   fontSize    – Base font size (default 52)
 *   color       – Text color (default white)
 *   fontWeight  – (default 800)
 *   delayFrames – Per-word stagger in frames (default 3)
 *   startFrame  – Frame offset before first word appears (default 0)
 *   emphasizeFirst – Scale-bounce the first word (default true)
 *   gradient    – Enable gradient sweep effect (default false)
 */
export const KineticText = ({
  text = "",
  fontSize = 52,
  color = "#f8fafc",
  fontWeight = 800,
  delayFrames = 3,
  startFrame = 0,
  emphasizeFirst = true,
  gradient = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return null;

  // Animated gradient sweep position (0→200% over 2s)
  const gradientPos = gradient
    ? interpolate(frame, [0, fps * 2], [0, 200], {
        extrapolateRight: "extend",
      })
    : 0;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0 0.32em",
        lineHeight: 1.12,
      }}
    >
      {words.map((word, idx) => {
        const wordFrame = frame - startFrame - idx * delayFrames;

        const entrance = spring({
          frame: Math.max(0, wordFrame),
          fps,
          config: { damping: 14, stiffness: 120, mass: 0.5 },
        });

        const opacity = interpolate(entrance, [0, 1], [0, 1]);
        const y = interpolate(entrance, [0, 1], [18, 0]);

        // Emphasis bounce on first word
        const scale =
          emphasizeFirst && idx === 0
            ? interpolate(
                spring({
                  frame: Math.max(0, wordFrame),
                  fps,
                  config: { damping: 8, stiffness: 200, mass: 0.4 },
                }),
                [0, 1],
                [0.7, 1],
              )
            : 1;

        const baseStyle = {
          display: "inline-block",
          fontSize,
          fontWeight,
          opacity: wordFrame < 0 ? 0 : opacity,
          transform: `translateY(${wordFrame < 0 ? 18 : y}px) scale(${scale})`,
          color,
          textShadow: "0 4px 20px rgba(14,165,233,0.22)",
        };

        // Gradient sweep effect
        const gradientStyle = gradient
          ? {
              background: `linear-gradient(90deg, #7dd3fc ${gradientPos - 40}%, ${color} ${gradientPos}%, ${color} 100%)`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }
          : {};

        return (
          <span key={idx} style={{ ...baseStyle, ...gradientStyle }}>
            {word}
          </span>
        );
      })}
    </div>
  );
};
