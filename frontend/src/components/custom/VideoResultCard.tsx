"use client";

import { useMemo, useState } from "react";
import { Expand, Minimize2, Sparkles, TriangleAlert, Video } from "lucide-react";
import { VideoResultData } from "@/lib/api";

interface VideoResultCardProps {
  data: VideoResultData;
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "--:--";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function VideoResultCard({ data }: VideoResultCardProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const progress = Math.max(0, Math.min(100, Number(data.progress_pct || 0)));
  const isReady = data.status === "ready" && Boolean(data.video_url);
  const isFailed = data.status === "failed";

  const badge = useMemo(() => {
    if (data.status === "ready") return "Ready";
    if (data.status === "failed") return "Failed";
    if (data.status === "rendering") return "Rendering";
    return "Queued";
  }, [data.status]);

  return (
    <>
      <div className="w-full rounded-xl border border-sky-400/30 bg-gradient-to-br from-[#04162e] via-[#0b2f5e] to-[#031b35] p-3 text-zinc-100 shadow-[0_20px_50px_rgba(7,94,179,0.22)]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sky-400/15 text-sky-200">
              <Video className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-sky-50">{data.title || "Generated Video"}</div>
              <div className="text-[11px] text-sky-100/80">
                {badge} &middot; {formatDuration(data.duration_ms)} &middot; {data.aspect_ratio || "16:9"}
              </div>
            </div>
          </div>
          {isReady && (
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-sky-300/40 bg-sky-200/10 px-2.5 py-1 text-[11px] font-medium text-sky-100 hover:bg-sky-100/20"
            >
              <Expand className="h-3.5 w-3.5" />
              Maximize
            </button>
          )}
        </div>

        {isReady ? (
          <video
            className="w-full rounded-lg border border-white/20 bg-black"
            controls
            preload="metadata"
            poster={data.poster_url || undefined}
            src={data.video_url}
          />
        ) : (
          <div className="rounded-lg border border-white/20 bg-black/40 p-4">
            {isFailed ? (
              <div className="flex items-start gap-2 text-red-200">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="text-xs">
                  <div className="font-semibold">Video render failed</div>
                  <div className="mt-1 text-red-100/90">{data.error || "Rendering service unavailable."}</div>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs text-sky-100/90">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{data.message || "Creating motion graphics timeline..."}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-blue-400 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-1 text-right text-[11px] text-sky-100/85">{progress}%</div>
              </div>
            )}
          </div>
        )}
      </div>

      {fullscreen && isReady && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4">
          <div className="relative w-full max-w-6xl">
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="absolute right-0 top-[-44px] inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              Minimize
            </button>
            <video
              className="max-h-[86vh] w-full rounded-xl border border-white/20 bg-black"
              controls
              autoPlay
              preload="metadata"
              poster={data.poster_url || undefined}
              src={data.video_url}
            />
          </div>
        </div>
      )}
    </>
  );
}
