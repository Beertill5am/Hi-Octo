"use client";

import { useState, useEffect } from "react";

interface TypewriterTextProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
  className?: string;
}

export function TypewriterText({
  text,
  speed = 350,
  onComplete,
  className = "",
}: TypewriterTextProps) {
  const [displayedText, setDisplayedText] = useState("");
  const [prevText, setPrevText] = useState(text);

  // Reset when text changes
  if (text !== prevText) {
    setPrevText(text);
    setDisplayedText("");
  }

  useEffect(() => {
    if (!text || displayedText.length >= text.length) {
      if (displayedText.length >= text.length && text.length > 0) {
        onComplete?.();
      }
      return;
    }

    const timeout = setTimeout(() => {
      setDisplayedText(text.slice(0, displayedText.length + 1));
    }, speed);

    return () => clearTimeout(timeout);
  }, [text, displayedText, speed, onComplete]);

  const isComplete = displayedText.length >= text.length;

  return (
    <span className={className}>
      {displayedText}
      {!isComplete && <span className="animate-pulse">▌</span>}
    </span>
  );
}
