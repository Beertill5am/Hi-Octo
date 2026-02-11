"use client";

/**
 * RelevanceBar - Visualizes relevance scores (0-100%)
 * using purple-only accents to match the UI palette.
 */

interface RelevanceBarProps {
  score: number; // 0.0 - 1.0
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function RelevanceBar({ score, showLabel = true, size = "sm" }: RelevanceBarProps) {
  const percentage = Math.round(score * 100);
  const textColor = "text-violet-300";
  const barColor = "bg-gradient-to-r from-violet-500 to-fuchsia-500";
  
  const barHeight = size === "sm" ? "h-1.5" : "h-2";
  const barWidth = size === "sm" ? "w-16" : "w-20";
  
  return (
    <div className="flex items-center gap-1.5">
      <div className={`${barWidth} ${barHeight} bg-zinc-800 rounded-full overflow-hidden`}>
        <div 
          className={`h-full ${barColor} transition-all duration-500 ease-out`} 
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <span className={`text-xs font-mono ${textColor} min-w-10`}>
          {percentage}%
        </span>
      )}
    </div>
  );
}
