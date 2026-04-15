"use client";

import { useState } from "react";

type FadeImageProps = {
  src: string;
  alt: string;
  className?: string;
};

export function FadeImage({ src, alt, className = "" }: FadeImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {!loaded && <div className="absolute inset-0 skeleton" />}
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
