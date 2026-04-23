"use client";

import { useEffect, useRef, useState } from "react";

type FadeImageProps = {
  src: string;
  alt: string;
  className?: string;
};

export function FadeImage({ src, alt, className = "" }: FadeImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(() => false);

  useEffect(() => {
    // ブラウザキャッシュ済み (preload 済) の画像は onLoad が発火しないことがあるため、
    // マウント/src 変更時に complete をチェックして即 loaded にする。
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      queueMicrotask(() => setLoaded(true));
    } else {
      queueMicrotask(() => setLoaded(false));
    }
  }, [src]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {!loaded && <div className="absolute inset-0 skeleton" />}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
