"use client";

import React from "react";

interface MaterialSymbolProps {
  name: string;
  className?: string;
  filled?: boolean;
  weight?: number;
  size?: number;
}

export function MaterialSymbol({
  name,
  className = "",
  filled = false,
  weight = 400,
  size = 20,
}: MaterialSymbolProps) {
  return (
    <span
      className={`material-symbols material-symbols-outlined ${filled ? "material-symbols-filled" : ""} ${className}`}
      style={
        {
          fontSize: size,
          "--fill": filled ? 1 : 0,
          "--wght": weight,
        } as React.CSSProperties
      }
      data-weight={weight}
      data-fill={filled ? 1 : 0}
    >
      {name}
    </span>
  );
}
