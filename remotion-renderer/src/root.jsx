import React from "react";
import { Composition } from "remotion";
import { BespokeVideo } from "./video/BespokeVideo";

const DEFAULT_SCRIPT = {
  title: "Python Variables Explained",
  theme: { colorMood: "python" },
  composition: {
    fps: 30,
    width: 1920,
    height: 1080,
    durationMs: 36000,
    aspectRatio: "16:9"
  },
  scenes: [
    {
      id: "scene_1",
      startMs: 0,
      durationMs: 4000,
      title: "The Hook",
      onScreenText: "Variables are the building blocks of every Python program.",
      bulletPoints: ["Variables are the building blocks of every Python program."],
      motionPreset: "intro",
      contentType: "general",
      visualStyle: "cinematic_kinetic_typography"
    },
    {
      id: "scene_2",
      startMs: 4000,
      durationMs: 6000,
      title: "What It Means",
      onScreenText: "A variable is a named reference to a value stored in memory.",
      bulletPoints: ["A variable is a named reference to a value stored in memory."],
      motionPreset: "hero_zoom_reveal",
      contentType: "definition",
      contentData: {
        term: "Variable",
        definition: "A named reference that points to a value stored in the computer's memory, allowing you to reuse and manipulate data throughout your program."
      },
      visualStyle: "cinematic_kinetic_typography"
    },
    {
      id: "scene_3",
      startMs: 10000,
      durationMs: 6000,
      title: "Head to Head",
      onScreenText: "Static typing requires explicit declarations, whereas dynamic typing infers types at runtime.",
      bulletPoints: [
        "Static typing requires explicit declarations.",
        "Dynamic typing infers types at runtime."
      ],
      motionPreset: "kinetic_slide_grid",
      contentType: "comparison",
      contentData: {
        left: "Static typing requires you to declare types upfront, catching errors at compile time.",
        right: "Dynamic typing infers types at runtime, offering flexibility but delaying error detection.",
        leftLabel: "Static",
        rightLabel: "Dynamic"
      },
      visualStyle: "cinematic_kinetic_typography"
    },
    {
      id: "scene_4",
      startMs: 16000,
      durationMs: 7000,
      title: "Step by Step",
      onScreenText: "First, choose a name. Then, assign a value. Finally, use the variable.",
      bulletPoints: [
        "Choose a descriptive variable name using snake_case.",
        "Assign a value with the = operator."
      ],
      motionPreset: "glow_track_emphasis",
      contentType: "process",
      contentData: {
        steps: [
          { label: "Choose a Name", detail: "Use descriptive snake_case names." },
          { label: "Assign a Value", detail: "Use = to bind a name to data." },
          { label: "Use the Variable", detail: "Reference by name in expressions." }
        ]
      },
      visualStyle: "cinematic_kinetic_typography"
    },
    {
      id: "scene_5",
      startMs: 23000,
      durationMs: 7000,
      title: "By the Numbers",
      onScreenText: "Python adoption grew 45% in the past two years among enterprise teams.",
      bulletPoints: ["Python adoption grew 45% in the past two years among enterprise teams."],
      motionPreset: "chart_pulse_highlight",
      contentType: "statistic",
      contentData: {
        value: 45,
        unit: "%",
        label: "Python adoption grew 45% in the past two years among enterprise teams."
      },
      visualStyle: "cinematic_kinetic_typography"
    },
    {
      id: "scene_6",
      startMs: 30000,
      durationMs: 6000,
      title: "Key Takeaways",
      onScreenText: "Variables are fundamental to every Python program.\nMaster naming, typing, and memory for clean code.",
      bulletPoints: [
        "Variables are fundamental to every Python program.",
        "Master naming, typing, and memory for clean code."
      ],
      motionPreset: "outro",
      contentType: "general",
      visualStyle: "cinematic_kinetic_typography"
    }
  ]
};


export const RemotionRoot = () => {
  return (
    <Composition
      id="BespokeVideo"
      component={BespokeVideo}
      fps={30}
      width={1920}
      height={1080}
      durationInFrames={180}
      defaultProps={{ script: DEFAULT_SCRIPT }}
      calculateMetadata={({ props }) => {
        const script = props?.script ?? DEFAULT_SCRIPT;
        const fps = script?.composition?.fps ?? 30;
        const width = script?.composition?.width ?? 1920;
        const height = script?.composition?.height ?? 1080;
        const durationMs = script?.composition?.durationMs ?? 6000;
        const durationInFrames = Math.max(30, Math.ceil((durationMs / 1000) * fps));
        return {
          fps,
          width,
          height,
          durationInFrames,
          props: { script }
        };
      }}
    />
  );
};
