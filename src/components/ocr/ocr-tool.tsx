"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CHAT_DRAFT_KEY } from "@/lib/prompts";
import { cn } from "@/lib/utils";

const MAX_FILE_MB = 15;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/bmp"];

type Phase =
  | { name: "idle" }
  | { name: "loading"; progress: number; status: string }
  | { name: "recognizing"; progress: number }
  | { name: "done" }
  | { name: "error"; message: string };

const STATUS_LABELS: Record<string, string> = {
  "loading tesseract core": "Loading the OCR engine…",
  "initializing tesseract": "Initializing…",
  "loading language traineddata": "Loading language data…",
  "initializing api": "Preparing…",
  "recognizing text": "Recognizing text…",
};

export function OcrTool() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const runOcr = useCallback(async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Supported formats: PNG, JPEG, WebP, BMP.");
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`The file is too large (maximum ${MAX_FILE_MB} MB).`);
      return;
    }

    setText("");
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    setPhase({ name: "loading", progress: 0, status: "Loading…" });

    try {
      // Dynamic import keeps ~1MB of OCR code out of the main bundle.
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["bul", "eng"], 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setPhase({ name: "recognizing", progress: m.progress });
          } else {
            setPhase({
              name: "loading",
              progress: m.progress,
              status: STATUS_LABELS[m.status] ?? m.status,
            });
          }
        },
      });
      try {
        const result = await worker.recognize(file);
        setText(result.data.text.trim());
        setPhase({ name: "done" });
      } finally {
        await worker.terminate();
      }
    } catch (err) {
      console.error("OCR failed:", err);
      setPhase({
        name: "error",
        message:
          "Recognition failed. Try another image or reload the page.",
      });
    }
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void runOcr(file);
  }

  function sendToChat() {
    if (!text.trim()) return;
    sessionStorage.setItem(CHAT_DRAFT_KEY, text.trim());
    router.push("/");
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Text copied.");
    } catch {
      toast.error("The browser blocked copying to the clipboard.");
    }
  }

  const isBusy = phase.name === "loading" || phase.name === "recognizing";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            OCR — text from image
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recognition (Bulgarian + English) runs entirely in your browser
            with Tesseract — the image never leaves your computer.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={onDrop}
          onClick={() => !isBusy && inputRef.current?.click()}
          className={cn(
            "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            isDragOver ? "border-primary bg-primary/5" : "hover:bg-accent/50",
            isBusy && "pointer-events-none opacity-60",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void runOcr(file);
              e.target.value = "";
            }}
          />
          <p className="text-sm font-medium">
            Drop an image here or click to browse
          </p>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, WebP or BMP · up to {MAX_FILE_MB} MB
          </p>
        </div>

        {isBusy && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {phase.name === "recognizing"
                ? "Recognizing text…"
                : phase.status}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.round(phase.progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {phase.name === "error" && (
          <p className="text-sm text-destructive">{phase.message}</p>
        )}

        {(previewUrl || text) && (
          <div className="grid gap-4 md:grid-cols-2">
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- local blob URL preview
              <img
                src={previewUrl}
                alt="Image preview"
                className="max-h-96 w-full rounded-lg border object-contain"
              />
            )}
            <div className="flex flex-col gap-2">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder={
                  isBusy ? "Recognizing…" : "The recognized text will appear here"
                }
                className="flex-1 resize-none font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyText()}
                  disabled={!text.trim()}
                >
                  Copy
                </Button>
                <Button size="sm" onClick={sendToChat} disabled={!text.trim()}>
                  To chat →
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
