import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { KineticText } from "./KineticText";
import { ComparisonScene } from "./ComparisonScene";
import { TimelineScene } from "./TimelineScene";
import { StatCounterScene } from "./StatCounterScene";
import { DefinitionScene } from "./DefinitionScene";

const FONT_STACK = '"Manrope", "Inter", "Avenir Next", "Segoe UI", sans-serif';

// ─── Colour palettes per motion preset ────────────────────────────────────────
const PALETTE = {
  intro:                { primary: "#a78bfa", accent: "#c084fc", glow: "rgba(167,139,250,0.35)" },
  hero_zoom_reveal:     { primary: "#3a86ff", accent: "#38bdf8", glow: "rgba(56,189,248,0.32)" },
  kinetic_slide_grid:   { primary: "#10b981", accent: "#34d399", glow: "rgba(52,211,153,0.30)" },
  parallax_depth_cards: { primary: "#f59e0b", accent: "#fbbf24", glow: "rgba(251,191,36,0.30)" },
  contrast_wipe:        { primary: "#ef4444", accent: "#f87171", glow: "rgba(248,113,113,0.28)" },
  chart_pulse_highlight:{ primary: "#8b5cf6", accent: "#a78bfa", glow: "rgba(139,92,246,0.32)" },
  glow_track_emphasis:  { primary: "#06b6d4", accent: "#22d3ee", glow: "rgba(34,211,238,0.30)" },
  outro:                { primary: "#ec4899", accent: "#f472b6", glow: "rgba(244,114,182,0.32)" },
};
const fallbackPalette = PALETTE.hero_zoom_reveal;

// ─── Contextual color-mood palettes (derived from topic) ──────────────────────
const COLOR_MOOD_PALETTES = {
  python:      { primary: "#3776ab", accent: "#ffd43b", glow: "rgba(55,118,171,0.35)" },
  data:        { primary: "#0d9488", accent: "#2dd4bf", glow: "rgba(13,148,136,0.30)" },
  security:    { primary: "#dc2626", accent: "#991b1b", glow: "rgba(220,38,38,0.28)" },
  performance: { primary: "#ea580c", accent: "#fb923c", glow: "rgba(234,88,12,0.30)" },
  web:         { primary: "#7c3aed", accent: "#a78bfa", glow: "rgba(124,58,237,0.32)" },
  ai:          { primary: "#0ea5e9", accent: "#38bdf8", glow: "rgba(14,165,233,0.32)" },
};

// ─── Helper: get palette — colorMood overrides preset palette ─────────────────
let _globalColorMood = null;
const paletteFor = (preset) => {
  if (_globalColorMood && COLOR_MOOD_PALETTES[_globalColorMood]) {
    // Blend: use mood's primary/glow but keep preset accent for variety
    const mood = COLOR_MOOD_PALETTES[_globalColorMood];
    const base = PALETTE[preset] || fallbackPalette;
    return { primary: mood.primary, accent: base.accent, glow: mood.glow };
  }
  return PALETTE[preset] || fallbackPalette;
};

// ─── Helper: compute which scene is active at a given global frame ────────────
function activeSceneInfo(scenes, fps, frame) {
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const from = Math.floor((s.startMs / 1000) * fps);
    const dur = Math.max(20, Math.floor((s.durationMs / 1000) * fps));
    if (frame >= from && frame < from + dur) {
      return { index: i, scene: s, localFrame: frame - from, durationInFrames: dur };
    }
  }
  return { index: scenes.length - 1, scene: scenes[scenes.length - 1], localFrame: 0, durationInFrames: 60 };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN COMPOSITION
// ═══════════════════════════════════════════════════════════════════════════════

export const BespokeVideo = ({ script }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const scenes = script?.scenes ?? [];
  const title = script?.title ?? "Generated Report";

  // Set global color mood from theme (read once, used by paletteFor)
  _globalColorMood = script?.theme?.colorMood || null;

  const { index: activeIdx, scene: activeScene } = activeSceneInfo(scenes, fps, frame);
  const activePreset = activeScene?.motionPreset || "hero_zoom_reveal";

  return (
    <AbsoluteFill style={{ backgroundColor: "#030712", color: "white", fontFamily: FONT_STACK }}>
      <AnimatedBackdrop frame={frame} activePreset={activePreset} />

      {scenes.map((scene, idx) => {
        const from = Math.floor((scene.startMs / 1000) * fps);
        const durationInFrames = Math.max(20, Math.floor((scene.durationMs / 1000) * fps));
        // Overlap: let adjacent scenes overlap by 12 frames for crossfade
        const overlap = idx > 0 ? 12 : 0;
        return (
          <Sequence
            key={scene.id || `${idx}`}
            from={Math.max(0, from - overlap)}
            durationInFrames={durationInFrames + overlap}
          >
            <SceneRouter scene={scene} index={idx} overlapFrames={overlap} />
          </Sequence>
        );
      })}

      <ProgressOverlay
        scenes={scenes}
        frame={frame}
        fps={fps}
        activeIdx={activeIdx}
      />
      <TitleStrip title={title} />
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  SCENE ROUTER — dispatches to the correct variant based on motionPreset
// ═══════════════════════════════════════════════════════════════════════════════

const SceneRouter = ({ scene, index, overlapFrames }) => {
  const contentType = scene.contentType || "general";
  const preset = scene.motionPreset || "hero_zoom_reveal";
  const props = { scene, index, overlapFrames };

  // Content-type routing takes priority over motionPreset for data-visual scenes
  if (contentType !== "general" && contentType !== "intro" && contentType !== "outro") {
    switch (contentType) {
      case "comparison": return <ComparisonScene {...props} />;
      case "process":    return <TimelineScene {...props} />;
      case "statistic":  return <StatCounterScene {...props} />;
      case "definition": return <DefinitionScene {...props} />;
    }
  }

  // Fall back to motionPreset routing
  switch (preset) {
    case "intro":                 return <IntroScene {...props} />;
    case "hero_zoom_reveal":      return <HeroZoomScene {...props} />;
    case "kinetic_slide_grid":    return <SlideGridScene {...props} />;
    case "parallax_depth_cards":  return <ParallaxCardsScene {...props} />;
    case "contrast_wipe":         return <ContrastWipeScene {...props} />;
    case "chart_pulse_highlight": return <PulseHighlightScene {...props} />;
    case "glow_track_emphasis":   return <GlowTrackScene {...props} />;
    case "outro":                 return <OutroScene {...props} />;
    default:                      return <HeroZoomScene {...props} />;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function useBullets(scene) {
  if (Array.isArray(scene.bulletPoints) && scene.bulletPoints.length) return scene.bulletPoints;
  return String(scene.onScreenText || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function useEntranceAndExit(overlapFrames = 0) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Entrance spring (starts after overlap settle)
  const entrance = spring({ frame: Math.max(0, frame - overlapFrames), fps, config: { damping: 14, stiffness: 100, mass: 0.8 } });

  // Fade + scale out over last 18 frames
  const exitStart = durationInFrames - 18;
  const fadeOut = interpolate(frame, [exitStart, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  const scaleOut = interpolate(frame, [exitStart, durationInFrames], [1, 0.96], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const blurOut = interpolate(frame, [exitStart, durationInFrames], [0, 4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Entrance fade (during overlap period)
  const fadeIn = overlapFrames > 0
    ? interpolate(frame, [0, overlapFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;

  const opacity = fadeIn * fadeOut;
  const y = interpolate(entrance, [0, 1], [34, 0]);
  const scale = interpolate(entrance, [0, 1], [0.96, 1]) * scaleOut;

  return { frame, entrance, opacity, y, scale, blurOut, fadeOut };
}

/** Staggered bullet list — shared across all scene types */
const StaggeredBullets = ({ bullets, color = "#e2e8f0", accentColor = "#7dd3fc", fontSize = 34, startDelay = 6 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ marginTop: 26, display: "grid", gap: 16 }}>
      {bullets.map((bullet, idx) => {
        const bulletFrame = frame - startDelay - idx * 6;
        const entrance = spring({ frame: Math.max(0, bulletFrame), fps, config: { damping: 12, stiffness: 90, mass: 0.6 } });
        const x = interpolate(entrance, [0, 1], [60, 0]);
        const opacity = bulletFrame < 0 ? 0 : interpolate(entrance, [0, 1], [0, 1]);
        return (
          <div
            key={idx}
            style={{
              display: "grid",
              gridTemplateColumns: "18px 1fr",
              gap: 12,
              alignItems: "start",
              color,
              fontSize,
              lineHeight: 1.24,
              fontWeight: 560,
              opacity,
              transform: `translateX(${bulletFrame < 0 ? 60 : x}px)`,
            }}
          >
            <span style={{ color: accentColor, marginTop: 3 }}>•</span>
            <span>{bullet}</span>
          </div>
        );
      })}
    </div>
  );
};

/** Scene badge pill */
const SceneBadge = ({ label, color = "rgba(56,189,248,0.18)", textColor = "#dbeafe" }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "8px 14px",
      borderRadius: 999,
      background: color,
      color: textColor,
      letterSpacing: "0.14em",
      fontSize: 19,
      textTransform: "uppercase",
      fontWeight: 700,
    }}
  >
    {label}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
//  1. INTRO SCENE — letter-by-letter title with starburst
// ═══════════════════════════════════════════════════════════════════════════════

const IntroScene = ({ scene, index, overlapFrames }) => {
  const { frame, opacity, scale, blurOut } = useEntranceAndExit(overlapFrames);
  const { fps } = useVideoConfig();
  const pal = paletteFor("intro");

  // Pulsing starburst
  const burstScale = 0.7 + 0.3 * Math.sin(frame / 20);
  const burstOpacity = 0.15 + 0.1 * Math.sin(frame / 15);

  // Slow zoom
  const zoom = interpolate(frame, [0, 120], [1.15, 1.0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "120px 160px",
        opacity,
        transform: `scale(${scale})`,
        filter: `blur(${blurOut}px)`,
      }}
    >
      {/* Starburst */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${pal.glow}, transparent 70%)`,
          transform: `scale(${burstScale})`,
          opacity: burstOpacity,
        }}
      />
      <div style={{ transform: `scale(${zoom})`, textAlign: "center", zIndex: 1 }}>
        <KineticText
          text={scene.title || "Introduction"}
          fontSize={72}
          color="#f8fafc"
          fontWeight={900}
          delayFrames={4}
          emphasizeFirst
          gradient
        />
        {scene.onScreenText && (
          <div style={{ marginTop: 32, opacity: interpolate(frame, [30, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            <KineticText
              text={scene.onScreenText.split("\n")[0] || ""}
              fontSize={32}
              color="#cbd5e1"
              fontWeight={500}
              delayFrames={2}
              startFrame={30}
              emphasizeFirst={false}
            />
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  2. HERO ZOOM REVEAL — full-bleed title zoom, bullets cascade from bottom
// ═══════════════════════════════════════════════════════════════════════════════

const HeroZoomScene = ({ scene, index, overlapFrames }) => {
  const { frame, entrance, opacity, y, scale, blurOut } = useEntranceAndExit(overlapFrames);
  const bullets = useBullets(scene);
  const pal = paletteFor("hero_zoom_reveal");

  // Slow zoom from 1.08x→1.0x
  const heroZoom = interpolate(frame, [0, 90], [1.08, 1.0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "90px 130px",
        opacity,
        filter: `blur(${blurOut}px)`,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1480,
          borderRadius: 36,
          padding: "56px 62px",
          border: `1px solid ${pal.glow}`,
          background: "linear-gradient(165deg, rgba(2,6,23,0.84), rgba(8,47,73,0.74) 55%, rgba(12,74,110,0.58))",
          boxShadow: `0 25px 80px ${pal.glow}`,
          transform: `translateY(${y}px) scale(${scale * heroZoom})`,
        }}
      >
        <SceneBadge label={`Scene ${index + 1}`} />
        <div style={{ marginTop: 20 }}>
          <KineticText text={scene.title} fontSize={52} fontWeight={800} delayFrames={3} gradient />
        </div>
        <StaggeredBullets bullets={bullets} accentColor={pal.accent} />
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  3. KINETIC SLIDE GRID — 2-column grid, cells slide from alternating edges
// ═══════════════════════════════════════════════════════════════════════════════

const SlideGridScene = ({ scene, index, overlapFrames }) => {
  const { frame, opacity, y, scale, blurOut } = useEntranceAndExit(overlapFrames);
  const { fps } = useVideoConfig();
  const bullets = useBullets(scene);
  const pal = paletteFor("kinetic_slide_grid");

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "90px 130px",
        opacity,
        filter: `blur(${blurOut}px)`,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1480,
          transform: `translateY(${y}px) scale(${scale})`,
        }}
      >
        <SceneBadge label={`Scene ${index + 1}`} color="rgba(16,185,129,0.20)" textColor="#a7f3d0" />
        <div style={{ marginTop: 20 }}>
          <KineticText text={scene.title} fontSize={48} fontWeight={800} delayFrames={3} />
        </div>
        <div
          style={{
            marginTop: 36,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
          }}
        >
          {bullets.map((bullet, idx) => {
            const bulletFrame = frame - 10 - idx * 8;
            const dir = idx % 2 === 0 ? -1 : 1; // alternating sides
            const entrance = spring({ frame: Math.max(0, bulletFrame), fps, config: { damping: 13, stiffness: 80, mass: 0.7 } });
            const x = interpolate(entrance, [0, 1], [120 * dir, 0]);
            const bOpacity = bulletFrame < 0 ? 0 : interpolate(entrance, [0, 1], [0, 1]);
            return (
              <div
                key={idx}
                style={{
                  padding: "22px 26px",
                  borderRadius: 20,
                  border: `1px solid ${pal.glow}`,
                  background: "linear-gradient(160deg, rgba(6,78,59,0.55), rgba(4,47,46,0.40))",
                  color: "#d1fae5",
                  fontSize: 30,
                  fontWeight: 560,
                  lineHeight: 1.26,
                  opacity: bOpacity,
                  transform: `translateX(${bulletFrame < 0 ? 120 * dir : x}px)`,
                }}
              >
                {bullet}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  4. PARALLAX DEPTH CARDS — overlapping cards with frame-based offset
// ═══════════════════════════════════════════════════════════════════════════════

const ParallaxCardsScene = ({ scene, index, overlapFrames }) => {
  const { frame, opacity, y, scale, blurOut } = useEntranceAndExit(overlapFrames);
  const { fps } = useVideoConfig();
  const bullets = useBullets(scene);
  const pal = paletteFor("parallax_depth_cards");

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "90px 130px",
        opacity,
        filter: `blur(${blurOut}px)`,
      }}
    >
      <div style={{ width: "100%", maxWidth: 1480, transform: `translateY(${y}px) scale(${scale})` }}>
        <SceneBadge label={`Scene ${index + 1}`} color="rgba(245,158,11,0.20)" textColor="#fef3c7" />
        <div style={{ marginTop: 20 }}>
          <KineticText text={scene.title} fontSize={48} fontWeight={800} delayFrames={3} />
        </div>
        <div style={{ marginTop: 36, position: "relative", height: bullets.length * 80 + 60 }}>
          {bullets.map((bullet, idx) => {
            const bulletFrame = frame - 8 - idx * 7;
            const entrance = spring({ frame: Math.max(0, bulletFrame), fps, config: { damping: 16, stiffness: 70, mass: 0.9 } });
            const bOpacity = bulletFrame < 0 ? 0 : interpolate(entrance, [0, 1], [0, 1]);
            const bY = interpolate(entrance, [0, 1], [50, 0]);
            // Parallax: slight drift based on global frame
            const parallaxX = Math.sin(frame / 30 + idx) * (6 + idx * 3);
            return (
              <div
                key={idx}
                style={{
                  position: "absolute",
                  top: idx * 80,
                  left: 20 + idx * 18,
                  right: 20 - idx * 18,
                  padding: "20px 28px",
                  borderRadius: 22,
                  border: `1px solid rgba(251,191,36,${0.25 - idx * 0.04})`,
                  background: `linear-gradient(160deg, rgba(120,53,15,${0.6 - idx * 0.08}), rgba(69,26,3,${0.5 - idx * 0.06}))`,
                  color: "#fef3c7",
                  fontSize: 30,
                  fontWeight: 560,
                  lineHeight: 1.26,
                  opacity: bOpacity,
                  transform: `translateY(${bulletFrame < 0 ? 50 : bY}px) translateX(${parallaxX}px)`,
                  zIndex: bullets.length - idx,
                  boxShadow: `0 8px 30px rgba(245,158,11,${0.12 + idx * 0.03})`,
                }}
              >
                {bullet}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  5. CONTRAST WIPE — horizontal reveal bar
// ═══════════════════════════════════════════════════════════════════════════════

const ContrastWipeScene = ({ scene, index, overlapFrames }) => {
  const { frame, opacity, y, scale, blurOut } = useEntranceAndExit(overlapFrames);
  const { fps, durationInFrames } = useVideoConfig();
  const bullets = useBullets(scene);
  const pal = paletteFor("contrast_wipe");

  // Wipe progresses from 0% to 100% over first 40% of scene
  const wipeEnd = durationInFrames * 0.4;
  const wipeProgress = interpolate(frame, [8, wipeEnd], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "90px 130px",
        opacity,
        filter: `blur(${blurOut}px)`,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1480,
          borderRadius: 36,
          padding: "56px 62px",
          border: `1px solid ${pal.glow}`,
          background: "linear-gradient(165deg, rgba(30,6,6,0.84), rgba(73,8,8,0.65) 55%, rgba(110,20,20,0.48))",
          boxShadow: `0 25px 80px ${pal.glow}`,
          transform: `translateY(${y}px) scale(${scale})`,
          // Clip reveal from left
          clipPath: `inset(0 ${100 - wipeProgress}% 0 0)`,
        }}
      >
        <SceneBadge label={`Scene ${index + 1}`} color="rgba(239,68,68,0.20)" textColor="#fecaca" />
        <div style={{ marginTop: 20 }}>
          <KineticText text={scene.title} fontSize={48} fontWeight={800} delayFrames={3} />
        </div>
        <StaggeredBullets
          bullets={bullets}
          accentColor={pal.accent}
          color="#fecaca"
          startDelay={Math.floor(wipeEnd * 0.5)}
        />
      </div>

      {/* Wipe bar */}
      {wipeProgress < 100 && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${wipeProgress}%`,
            width: 4,
            background: `linear-gradient(180deg, transparent, ${pal.accent}, transparent)`,
            boxShadow: `0 0 30px ${pal.glow}, 0 0 60px ${pal.glow}`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  6. CHART PULSE HIGHLIGHT — large pulsing accent circle + glowing bullets
// ═══════════════════════════════════════════════════════════════════════════════

const PulseHighlightScene = ({ scene, index, overlapFrames }) => {
  const { frame, opacity, y, scale, blurOut } = useEntranceAndExit(overlapFrames);
  const bullets = useBullets(scene);
  const pal = paletteFor("chart_pulse_highlight");

  const pulseScale = 1 + 0.08 * Math.sin(frame / 12);
  const pulseOpacity = 0.18 + 0.08 * Math.sin(frame / 10);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "90px 130px",
        opacity,
        filter: `blur(${blurOut}px)`,
      }}
    >
      {/* Background pulse circle */}
      <div
        style={{
          position: "absolute",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${pal.glow}, transparent 65%)`,
          transform: `scale(${pulseScale})`,
          opacity: pulseOpacity,
          right: -100,
          top: -80,
        }}
      />
      <div style={{ width: "100%", maxWidth: 1480, transform: `translateY(${y}px) scale(${scale})`, zIndex: 1 }}>
        <SceneBadge label={`Scene ${index + 1}`} color="rgba(139,92,246,0.22)" textColor="#ddd6fe" />
        <div style={{ marginTop: 20 }}>
          <KineticText text={scene.title} fontSize={56} fontWeight={900} delayFrames={3} gradient />
        </div>
        <StaggeredBullets bullets={bullets} accentColor={pal.accent} color="#ede9fe" fontSize={36} />
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  7. GLOW TRACK EMPHASIS — traveling glow underline across each bullet
// ═══════════════════════════════════════════════════════════════════════════════

const GlowTrackScene = ({ scene, index, overlapFrames }) => {
  const { frame, opacity, y, scale, blurOut } = useEntranceAndExit(overlapFrames);
  const { fps, durationInFrames } = useVideoConfig();
  const bullets = useBullets(scene);
  const pal = paletteFor("glow_track_emphasis");

  // Which bullet is currently being "tracked"
  const bulletDuration = durationInFrames / Math.max(bullets.length, 1);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "90px 130px",
        opacity,
        filter: `blur(${blurOut}px)`,
      }}
    >
      <div style={{ width: "100%", maxWidth: 1480, transform: `translateY(${y}px) scale(${scale})` }}>
        <SceneBadge label={`Scene ${index + 1}`} color="rgba(6,182,212,0.20)" textColor="#cffafe" />
        <div style={{ marginTop: 20 }}>
          <KineticText text={scene.title} fontSize={48} fontWeight={800} delayFrames={3} />
        </div>
        <div style={{ marginTop: 32, display: "grid", gap: 18 }}>
          {bullets.map((bullet, idx) => {
            const bulletFrame = frame - 8 - idx * 6;
            const entrance = spring({ frame: Math.max(0, bulletFrame), fps, config: { damping: 12, stiffness: 90, mass: 0.6 } });
            const bOpacity = bulletFrame < 0 ? 0 : interpolate(entrance, [0, 1], [0, 1]);
            const bX = interpolate(entrance, [0, 1], [40, 0]);

            // Glow underline progress for this particular bullet
            const glowStart = idx * bulletDuration + 15;
            const glowEnd = glowStart + bulletDuration * 0.6;
            const glowWidth = interpolate(frame, [glowStart, glowEnd], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const isActive = frame >= glowStart && frame < glowEnd + bulletDuration * 0.4;

            return (
              <div
                key={idx}
                style={{
                  position: "relative",
                  padding: "14px 22px",
                  borderRadius: 14,
                  color: isActive ? "#ecfeff" : "#a5f3fc",
                  fontSize: 32,
                  fontWeight: 560,
                  lineHeight: 1.28,
                  opacity: bOpacity,
                  transform: `translateX(${bulletFrame < 0 ? 40 : bX}px) scale(${isActive ? 1.02 : 1})`,
                  transition: "color 0.15s",
                }}
              >
                <span style={{ marginRight: 12, color: pal.accent }}>▸</span>
                {bullet}
                {/* Glow underline */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 22,
                    height: 3,
                    width: `${glowWidth}%`,
                    borderRadius: 2,
                    background: `linear-gradient(90deg, ${pal.accent}, transparent)`,
                    boxShadow: isActive ? `0 0 12px ${pal.glow}` : "none",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  8. OUTRO SCENE — summary card with gentle bounce
// ═══════════════════════════════════════════════════════════════════════════════

const OutroScene = ({ scene, index, overlapFrames }) => {
  const { frame, opacity, scale, blurOut } = useEntranceAndExit(overlapFrames);
  const { fps } = useVideoConfig();
  const bullets = useBullets(scene);
  const pal = paletteFor("outro");

  const bounce = spring({ frame, fps, config: { damping: 10, stiffness: 60, mass: 1.2 } });
  const bounceY = interpolate(bounce, [0, 1], [60, 0]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "90px 160px",
        opacity,
        filter: `blur(${blurOut}px)`,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1400,
          borderRadius: 40,
          padding: "60px 64px",
          border: `1px solid rgba(244,114,182,0.30)`,
          background: "linear-gradient(170deg, rgba(30,3,20,0.88), rgba(80,7,50,0.60) 60%, rgba(131,24,67,0.45))",
          boxShadow: `0 30px 90px ${pal.glow}`,
          transform: `translateY(${bounceY}px) scale(${scale})`,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 22, letterSpacing: "0.18em", textTransform: "uppercase", color: "#fbcfe8", fontWeight: 700 }}>
          Key Takeaways
        </div>
        <div style={{ marginTop: 16 }}>
          <KineticText text={scene.title || "Summary"} fontSize={50} fontWeight={800} delayFrames={3} gradient />
        </div>
        <StaggeredBullets
          bullets={bullets}
          accentColor={pal.accent}
          color="#fce7f3"
          fontSize={30}
          startDelay={14}
        />
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  ANIMATED BACKDROP — reactive to active scene preset
// ═══════════════════════════════════════════════════════════════════════════════

const AnimatedBackdrop = ({ frame, activePreset }) => {
  const pal = paletteFor(activePreset);
  const drift = Math.sin(frame / 38) * 40;
  const drift2 = Math.cos(frame / 52) * 36;
  const opacityPulse = 0.22 + 0.08 * Math.sin(frame / 45);

  // Speed varies by preset energy
  const energyMultiplier = (activePreset === "chart_pulse_highlight" || activePreset === "intro") ? 1.5 : 1.0;
  const rotSpeed = frame * 0.18 * energyMultiplier;

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(80% 80% at 15% 10%, ${pal.glow}, rgba(3,7,18,0) 70%), radial-gradient(90% 90% at 85% 85%, rgba(246,174,45,0.20), rgba(3,7,18,0) 68%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 140 + drift,
          left: 180 + drift2,
          width: 520,
          height: 520,
          borderRadius: 40,
          transform: `rotate(${rotSpeed}deg)`,
          background: `linear-gradient(145deg, ${pal.glow}, rgba(59,130,246,0.10), rgba(245,158,11,0.12))`,
          filter: "blur(6px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 140 - drift2,
          bottom: 90 - drift,
          width: 420,
          height: 420,
          borderRadius: 999,
          background: `conic-gradient(from 45deg, ${pal.glow}, rgba(45,212,191,0.12), rgba(246,174,45,0.18), ${pal.glow})`,
          opacity: opacityPulse,
        }}
      />
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  PROGRESS OVERLAY — thin bar + scene counter
// ═══════════════════════════════════════════════════════════════════════════════

const ProgressOverlay = ({ scenes, frame, fps, activeIdx }) => {
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 100], { extrapolateRight: "clamp" });

  // Fade in after 0.5s
  const overlayOpacity = interpolate(frame, [0, Math.floor(fps * 0.5)], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, opacity: overlayOpacity, zIndex: 10 }}>
      {/* Scene counter pill */}
      <div
        style={{
          position: "absolute",
          right: 36,
          bottom: 102,
          padding: "6px 16px",
          borderRadius: 12,
          background: "rgba(15,23,42,0.70)",
          border: "1px solid rgba(148,163,184,0.22)",
          color: "#94a3b8",
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: "0.06em",
          backdropFilter: "blur(8px)",
        }}
      >
        {activeIdx + 1} / {scenes.length}
      </div>
      {/* Progress bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 4,
          background: "rgba(30,41,59,0.60)",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            borderRadius: "0 2px 2px 0",
            background: "linear-gradient(90deg, #3a86ff, #38bdf8, #f6ae2d)",
            boxShadow: "0 0 12px rgba(56,189,248,0.40)",
          }}
        />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  TITLE STRIP — persistent bottom bar with video title
// ═══════════════════════════════════════════════════════════════════════════════

const TitleStrip = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const alpha = interpolate(frame, [0, fps * 0.8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 36,
        right: 36,
        bottom: 14,
        height: 62,
        borderRadius: 20,
        border: "1px solid rgba(186,230,253,0.36)",
        background: "linear-gradient(90deg, rgba(12,74,110,0.66), rgba(3,105,161,0.46), rgba(15,23,42,0.55))",
        padding: "0 22px",
        display: "flex",
        alignItems: "center",
        color: "#e0f2fe",
        fontSize: 24,
        fontWeight: 700,
        letterSpacing: "0.02em",
        opacity: alpha,
      }}
    >
      {title}
    </div>
  );
};
