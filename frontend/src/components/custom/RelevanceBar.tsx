"use client";

/**
 * RelevanceBar - Visualizes relevance scores (0-100%)
 * with color coding: green (80%+), amber (50-79%), red (<50%)
 */

interface RelevanceBarProps {
  score: number; // 0.0 - 1.0
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function RelevanceBar({ score, showLabel = true, size = "sm" }: RelevanceBarProps) {
  const percentage = Math.round(score * 100);
  
  // Color coding based on relevance
  let barColor = "bg-red-500";
  let textColor = "text-red-600";
  if (percentage >= 80) {
    barColor = "bg-emerald-500";
    textColor = "text-emerald-600";
  } else if (percentage >= 50) {
    barColor = "bg-amber-500";
    textColor = "text-amber-600";
  }
  
  const barHeight = size === "sm" ? "h-1.5" : "h-2";
  const barWidth = size === "sm" ? "w-16" : "w-20";
  
  return (
    <div className="flex items-center gap-1.5">
      <div className={`${barWidth} ${barHeight} bg-muted rounded-full overflow-hidden`}>
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
