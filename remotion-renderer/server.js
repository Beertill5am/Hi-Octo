import "dotenv/config";
import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { getCompositions, renderMedia } from "@remotion/renderer";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = Number(process.env.PORT || 3030);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, "");
const OUTPUT_DIR = path.join(__dirname, "renders");
const ENTRY = path.join(__dirname, "src", "index.jsx");

let bundlePromise = null;

const sceneSchema = z.object({
  id: z.string().optional(),
  startMs: z.number().nonnegative().optional(),
  durationMs: z.number().positive(),
  title: z.string().optional(),
  onScreenText: z.string(),
  bulletPoints: z.array(z.string()).optional(),
  motionPreset: z.string().optional(),
  visualStyle: z.string().optional(),
  contentType: z.string().optional(),
  contentData: z.any().optional()
});

const renderRequestSchema = z.object({
  jobId: z.string().min(1),
  topic: z.string().min(1),
  answer: z.string().min(1),
  script: z.object({
    title: z.string().optional(),
    composition: z.object({
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      fps: z.number().int().positive().optional(),
      durationMs: z.number().int().positive().optional(),
      aspectRatio: z.string().optional()
    }).optional(),
    theme: z.record(z.any()).optional(),
    scenes: z.array(sceneSchema).min(1)
  }),
  qualityProfile: z.string().optional(),
  ttsEnabled: z.boolean().optional()
});

app.use(cors());
app.use(express.json({ limit: "4mb" }));
app.use("/renders", express.static(OUTPUT_DIR));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "remotion-renderer" });
});

app.post("/render", async (req, res) => {
  const parsed = renderRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid render payload",
      details: parsed.error.flatten()
    });
  }

  const payload = parsed.data;
  const script = normalizeScript(payload.script, payload.topic, payload.answer);
  const renderId = `${payload.jobId}-${Date.now()}`;
  const outName = `${renderId}.mp4`;
  const outPath = path.join(OUTPUT_DIR, outName);

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const serveUrl = await getServeUrl();
    const comps = await getCompositions(serveUrl, {
      inputProps: { script }
    });
    const composition = comps.find((c) => c.id === "BespokeVideo");
    if (!composition) {
      throw new Error("Composition `BespokeVideo` not found.");
    }

    await renderMedia({
      serveUrl,
      composition,
      inputProps: { script },
      codec: "h264",
      outputLocation: outPath,
      imageFormat: "jpeg",
      crf: 18,
      logLevel: "info"
    });

    return res.json({
      videoUrl: `${PUBLIC_BASE_URL}/renders/${outName}`,
      posterUrl: null,
      durationMs: script.composition.durationMs,
      aspectRatio: script.composition.aspectRatio,
      providerJobId: renderId
    });
  } catch (error) {
    return res.status(500).json({
      error: "Render failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Remotion renderer running on ${PUBLIC_BASE_URL}`);
});

async function getServeUrl() {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: ENTRY,
      onProgress: (p) => {
        if (p % 0.25 < 0.01) {
          console.log(`Bundling progress ${Math.round(p * 100)}%`);
        }
      }
    });
  }
  return bundlePromise;
}

function normalizeScript(script, topic, answer) {
  const fps = script.composition?.fps ?? 30;
  const width = script.composition?.width ?? 1920;
  const height = script.composition?.height ?? 1080;

  const BODY_PRESETS = [
    "hero_zoom_reveal",
    "kinetic_slide_grid",
    "parallax_depth_cards",
    "contrast_wipe",
    "glow_track_emphasis",
  ];

  const totalScenes = script.scenes.length;
  const narrativePreset = (idx) => {
    if (idx === 0) return "intro";
    if (idx === totalScenes - 1 && totalScenes > 2) return "outro";
    if (idx === totalScenes - 2 && totalScenes > 3) return "chart_pulse_highlight";
    return BODY_PRESETS[(idx - 1) % BODY_PRESETS.length];
  };

  const scenes = script.scenes.map((scene, idx) => ({
    id: scene.id || `scene_${idx + 1}`,
    startMs: Number(scene.startMs ?? 0),
    durationMs: Math.max(1500, Number(scene.durationMs)),
    title: scene.title || `Point ${idx + 1}`,
    onScreenText: scene.onScreenText || answer,
    bulletPoints: Array.isArray(scene.bulletPoints) ? scene.bulletPoints.slice(0, 4) : undefined,
    motionPreset: scene.motionPreset || narrativePreset(idx),
    visualStyle: scene.visualStyle || "cinematic_kinetic_typography",
    contentType: scene.contentType || "general",
    ...(scene.contentData ? { contentData: scene.contentData } : {})
  }));

  let rollingStart = 0;
  for (const scene of scenes) {
    scene.startMs = rollingStart;
    rollingStart += scene.durationMs;
  }

  const durationMs = rollingStart;
  return {
    title: script.title || topic,
    theme: { ...(script.theme || {}), colorMood: script.theme?.colorMood || null },
    composition: {
      fps,
      width,
      height,
      durationMs,
      aspectRatio: script.composition?.aspectRatio || "16:9"
    },
    scenes
  };
}

