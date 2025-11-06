"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import imageCompression from "browser-image-compression";
import JSZip from "jszip";
import { saveAs } from "file-saver";

type ProcessedImage = {
  id: string;
  name: string;
  originalSize: number;
  compressedSize: number;
  originalDimensions: { width: number; height: number };
  compressedDimensions: { width: number; height: number };
  compressedBlob: Blob;
  previewUrl: string;
};

const generateId = () => crypto.randomUUID();

async function getImageDimensions(file: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = event => reject(event);
    });
    return {
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function compressFile(
  file: File,
  options: {
    quality: number;
    maxWidth: number;
    maxHeight: number;
  }
): Promise<ProcessedImage> {
  const { quality, maxHeight, maxWidth } = options;

  const originalDimensions = await getImageDimensions(file);
  let compressedBlob: Blob = file;

  if (file.type === "image/svg+xml") {
    compressedBlob = file;
  } else {
    const maxEdge = Math.max(maxWidth, maxHeight);
    compressedBlob = await imageCompression(file, {
      maxWidthOrHeight: maxEdge > 0 ? maxEdge : undefined,
      initialQuality: quality,
      useWebWorker: true,
      fileType: file.type || undefined,
      alwaysKeepResolution: false
    });
  }

  const compressedDimensions = await getImageDimensions(compressedBlob);
  const previewUrl = URL.createObjectURL(compressedBlob);

  return {
    id: generateId(),
    name: file.name,
    originalSize: file.size,
    compressedSize: compressedBlob.size,
    originalDimensions,
    compressedDimensions,
    compressedBlob,
    previewUrl
  };
}

type CompressionSettings = {
  quality: number;
  maxWidth: number;
  maxHeight: number;
};

export default function Page() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<CompressionSettings>({
    quality: 0.7,
    maxWidth: 1920,
    maxHeight: 1920
  });
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ProcessedImage[]>([]);

  useEffect(() => {
    return () => {
      results.forEach(item => URL.revokeObjectURL(item.previewUrl));
    };
  }, [results]);

  const totalSavings = useMemo(() => {
    if (!results.length) {
      return 0;
    }
    const original = results.reduce((acc, item) => acc + item.originalSize, 0);
    const compressed = results.reduce((acc, item) => acc + item.compressedSize, 0);
    return original - compressed;
  }, [results]);

  const savingsPercent = useMemo(() => {
    if (!results.length) {
      return 0;
    }
    const original = results.reduce((acc, item) => acc + item.originalSize, 0);
    if (original === 0) {
      return 0;
    }
    return Math.max(0, (totalSavings / original) * 100);
  }, [results, totalSavings]);

  const resetPreviews = useCallback(() => {
    setResults(prev => {
      prev.forEach(item => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  }, []);

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter(file => file.type.startsWith("image/"));
      if (!list.length) {
        setError("Please choose image files (PNG, JPG, WebP, SVG).");
        return;
      }
      setError(null);
      setIsProcessing(true);
      resetPreviews();
      setResults([]);

      try {
        const processed: ProcessedImage[] = [];
        for (const file of list) {
          const compressed = await compressFile(file, {
            quality: settings.quality,
            maxWidth: settings.maxWidth,
            maxHeight: settings.maxHeight
          });
          processed.push(compressed);
          setResults(prev => [...prev, compressed]);
        }
        setSourceFiles(list);
      } catch (compressionError) {
        console.error(compressionError);
        setError("Something went wrong while compressing images.");
      } finally {
        setIsProcessing(false);
      }
    },
    [resetPreviews, settings]
  );

  const recompress = useCallback(async () => {
    if (!sourceFiles.length) {
      return;
    }
    setIsProcessing(true);
    resetPreviews();
    setResults([]);

    try {
      for (const file of sourceFiles) {
        const compressed = await compressFile(file, {
          quality: settings.quality,
          maxWidth: settings.maxWidth,
          maxHeight: settings.maxHeight
        });
        setResults(prev => [...prev, compressed]);
      }
    } catch (compressionError) {
      console.error(compressionError);
      setError("Recompression failed. Try different settings.");
    } finally {
      setIsProcessing(false);
    }
  }, [resetPreviews, settings, sourceFiles]);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      if (event.dataTransfer?.files) {
        void processFiles(event.dataTransfer.files);
      }
    },
    [processFiles]
  );

  const handleBrowse = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files) {
        void processFiles(files);
      }
    },
    [processFiles]
  );

  const downloadFile = useCallback((item: ProcessedImage) => {
    const extension = item.name.includes(".")
      ? item.name.replace(/\.[^/.]+$/, "")
      : item.name;
    const fileName = `${extension}-compressed.${item.compressedBlob.type.split("/").at(1) ?? "jpg"}`;
    saveAs(item.compressedBlob, fileName);
  }, []);

  const downloadAll = useCallback(async () => {
    if (!results.length) return;
    const archive = new JSZip();
    for (const item of results) {
      const extension = item.name.includes(".")
        ? item.name.replace(/\.[^/.]+$/, "")
        : item.name;
      const fileName = `${extension}-compressed.${item.compressedBlob.type.split("/").at(1) ?? "jpg"}`;
      archive.file(fileName, item.compressedBlob);
    }
    const content = await archive.generateAsync({ type: "blob" });
    saveAs(content, `compressed-${Date.now()}.zip`);
  }, [results]);

  const formatBytes = (value: number) => {
    if (value === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.floor(Math.log(value) / Math.log(1024));
    const size = value / Math.pow(1024, index);
    return `${size.toFixed(size > 10 || index === 0 ? 0 : 1)} ${units[index]}`;
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="badge">Made for creators · Runs entirely in your browser</div>
        <h1 className="app-title">SnapShrink</h1>
        <p className="app-subtitle">
          Drag & drop your images, choose the quality and dimensions you need, and download optimized results instantly.
          No uploads, no waiting, just pure compression power.
        </p>
      </header>

      <section className="controls">
        <div className="group">
          <div className="flex-between">
            <label>Quality</label>
            <span>{Math.round(settings.quality * 100)}%</span>
          </div>
          <div className="slider-row">
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={settings.quality}
              onChange={event => setSettings(prev => ({ ...prev, quality: Number(event.target.value) }))}
              disabled={isProcessing}
            />
          </div>
          <small>Higher quality yields larger file sizes. Recommended: 60% - 85%.</small>
        </div>
        <div className="group">
          <label>Maximum dimensions (px)</label>
          <div className="input-inline">
            <label>
              Width
              <input
                type="number"
                min={320}
                max={8000}
                value={settings.maxWidth}
                onChange={event =>
                  setSettings(prev => ({
                    ...prev,
                    maxWidth: Number(event.target.value) || prev.maxWidth
                  }))
                }
                disabled={isProcessing}
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min={320}
                max={8000}
                value={settings.maxHeight}
                onChange={event =>
                  setSettings(prev => ({
                    ...prev,
                    maxHeight: Number(event.target.value) || prev.maxHeight
                  }))
                }
                disabled={isProcessing}
              />
            </label>
          </div>
          <small>Keep aspect ratio is automatic. The longer edge is capped to these limits.</small>
        </div>
        <div className="button-row">
          <button
            className="btn-primary"
            type="button"
            onClick={handleBrowse}
            disabled={isProcessing}
          >
            {isProcessing ? "Processing..." : "Select Images"}
          </button>
          {sourceFiles.length > 0 && (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => void recompress()}
              disabled={isProcessing}
            >
              Apply New Settings
            </button>
          )}
        </div>
      </section>

      <label
        className={`dropzone ${isDragging ? "active" : ""}`}
        onDragOver={event => {
          event.preventDefault();
          event.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={event => {
          event.preventDefault();
          event.stopPropagation();
          setIsDragging(false);
        }}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleInputChange}
        />
        <div className="dropzone-icon">📦</div>
        <h3>{isProcessing ? "Crunching pixels..." : "Drop images here"}</h3>
        <p>PNG, JPG, SVG, WebP up to 20MB each. You can also click to browse.</p>
      </label>

      {error && <div className="badge" style={{ background: "rgba(248, 113, 113, 0.15)", color: "#fecaca" }}>{error}</div>}

      <section className="preview-grid">
        <div className="flex-between">
          <h3>Compressed images</h3>
          {results.length > 0 && (
            <div>
              <span>Total saved:</span>{" "}
              <span className="inline-code">
                {formatBytes(totalSavings)} ({savingsPercent.toFixed(1)}%)
              </span>
            </div>
          )}
        </div>

        {results.length === 0 ? (
          <div className="empty-state">
            {isProcessing ? "Working magic on your files..." : "Your compressed images will appear here."}
          </div>
        ) : (
          <>
            <div className="button-row">
              <button className="btn-primary" type="button" onClick={() => void downloadAll()}>
                Download All
              </button>
            </div>
            <div className="card-grid">
              {results.map(item => {
                const ratio =
                  item.originalSize === 0
                    ? 0
                    : Math.max(0, 1 - item.compressedSize / item.originalSize);
                return (
                  <article className="preview-card" key={item.id}>
                    <NextImage
                      src={item.previewUrl}
                      alt={`Compressed preview of ${item.name}`}
                      width={item.compressedDimensions.width || 1}
                      height={item.compressedDimensions.height || 1}
                      unoptimized
                      style={{
                        width: "100%",
                        height: "180px",
                        objectFit: "contain",
                        background: "rgba(248, 250, 252, 0.08)",
                        borderRadius: "0.9rem"
                      }}
                    />
                    <div>
                      <strong>{item.name}</strong>
                    </div>
                    <div className="stat-row">
                      <span>Original</span>
                      <span>
                        {formatBytes(item.originalSize)} · {item.originalDimensions.width}×
                        {item.originalDimensions.height}
                      </span>
                    </div>
                    <div className="stat-row">
                      <span>Compressed</span>
                      <span>
                        {formatBytes(item.compressedSize)} · {item.compressedDimensions.width}×
                        {item.compressedDimensions.height}
                      </span>
                    </div>
                    <progress className="progress" max={1} value={ratio} />
                    <div className="stat-row">
                      <span>Saved</span>
                      <span>{(ratio * 100).toFixed(1)}%</span>
                    </div>
                    <button className="btn-secondary" type="button" onClick={() => downloadFile(item)}>
                      Download
                    </button>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
