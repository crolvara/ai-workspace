"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CHAT_DRAFT_KEY } from "@/lib/prompts";
import { DEFAULT_MODEL_KEY } from "@/lib/models";
import { readChatStream } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

const MAX_FILE_MB = 15;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/bmp"];

// The chat route caps a single message at 8000 chars; leave room for the prompt.
const MAX_STRUCTURE_INPUT = 7000;

/**
 * Instructs a chat model to clean OCR noise (stray glyphs, broken line breaks,
 * UI chrome captured from the screenshot) without translating or rewriting.
 * Sent as a plain user message because /api/chat takes no system prompt.
 */
function buildStructurePrompt(raw: string): string {
  return `You are a text-cleanup assistant. The text below was extracted by OCR from a screenshot and contains recognition noise: stray foreign characters, broken line breaks, and garbled fragments (browser/app UI, toolbar glyphs, page chrome). Reconstruct the intended document text.

Rules:
- Remove OCR artifacts, stray symbols, and fragments that are clearly not part of the document (browser or app UI, toolbar icons, tab titles, page chrome).
- Fix line breaks and paragraph structure; keep real paragraphs and lists.
- Do NOT translate, rephrase, summarize, or add anything — preserve the original wording and language.
- Output only the cleaned text, with no explanations, headings, or code fences.

OCR text:
"""
${raw}
"""`;
}

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
  const [isStructuring, setIsStructuring] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Lets runOcr's stable useCallback trigger the always-fresh cleanup closure
  // without pulling it into the callback's dependency list (stale-closure trap).
  const structureRef = useRef<(source?: string) => void>(() => {});
  // Aborts an in-flight AI-cleanup stream (e.g. on unmount) so it stops burning
  // free-tier quota and doesn't setText on an unmounted component.
  const cleanupAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => cleanupAbortRef.current?.abort(), []);

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
        const recognized = result.data.text.trim();
        setPhase({ name: "done" });
        // Auto-clean the raw recognition so the user gets structured text
        // directly instead of the noisy OCR output. The cleanup streams into the
        // (still empty) textarea and reveals the raw text if it fails, so we
        // deliberately do NOT setText(recognized) here — that would flash the
        // garbled version before the cleaned one replaces it.
        if (recognized) {
          structureRef.current(recognized);
        } else {
          setText(recognized);
        }
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
    if (inputLocked) return;
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

  // `source` is passed by the auto-clean path (state isn't updated yet right
  // after recognition); the manual button omits it and cleans the current text.
  async function structureWithAI(source?: string) {
    const original = source ?? text;
    const raw = original.trim();
    if (!raw || isStructuring) return;
    if (raw.length > MAX_STRUCTURE_INPUT) {
      // Reveal the raw text (the auto path hasn't shown it yet) instead of cleaning.
      setText(original);
      toast.error(
        `The text is too long to clean up automatically (over ${MAX_STRUCTURE_INPUT} characters).`,
      );
      return;
    }

    setIsStructuring(true);
    const controller = new AbortController();
    cleanupAbortRef.current = controller;
    let cleaned = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: buildStructurePrompt(raw),
          model: DEFAULT_MODEL_KEY,
          // Don't persist this as a conversation — it's a one-off cleanup pass.
          ephemeral: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setText(original);
        toast.error(error ?? "Cleanup failed. Please try again.");
        return;
      }

      // We overwrite the textarea live as chunks arrive (the value is controlled
      // by `text`, so each setText replaces whatever was shown). On ANY failure
      // we restore `original` so the user is never left with half-cleaned text
      // or — on the auto path — an empty box.
      for await (const event of readChatStream(res)) {
        if (event.type === "delta") {
          cleaned += event.text;
          setText(cleaned);
        } else if (event.type === "error") {
          setText(original);
          toast.error(event.message);
          return;
        }
      }

      if (cleaned.trim()) {
        toast.success("Text cleaned up.");
      } else {
        setText(original);
        toast.error("Cleanup returned an empty result. Please try again.");
      }
    } catch (err) {
      // Aborted (component unmounting) — leave state alone, nothing to restore.
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("OCR cleanup failed:", err);
      setText(original);
      toast.error("Cleanup failed. Please try again.");
    } finally {
      if (cleanupAbortRef.current === controller) cleanupAbortRef.current = null;
      setIsStructuring(false);
    }
  }
  // Keep the ref pointing at the current-render closure so runOcr's stable
  // callback always calls the latest one (updated after every render).
  useEffect(() => {
    structureRef.current = structureWithAI;
  });

  const isBusy = phase.name === "loading" || phase.name === "recognizing";
  // Also block starting a new recognition while a cleanup stream is writing to
  // the textarea — otherwise the two overwrite each other's setText calls.
  const inputLocked = isBusy || isStructuring;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            OCR — text from image
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recognition (Bulgarian + English) runs entirely in your browser
            with Tesseract — the image never leaves your computer. Clean up with
            AI removes recognition noise and restores the structure.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={onDrop}
          onClick={() => !inputLocked && inputRef.current?.click()}
          className={cn(
            "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            isDragOver ? "border-primary bg-primary/5" : "hover:bg-accent/50",
            inputLocked && "pointer-events-none opacity-60",
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
                disabled={isStructuring}
                placeholder={
                  isBusy
                    ? "Recognizing…"
                    : isStructuring
                      ? "Cleaning up…"
                      : "The recognized text will appear here"
                }
                className="flex-1 resize-none font-mono text-xs"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void structureWithAI()}
                  disabled={!text.trim() || isStructuring}
                >
                  <Sparkles className="size-4" />
                  {isStructuring ? "Cleaning up…" : "Clean up with AI"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyText()}
                  disabled={!text.trim() || isStructuring}
                >
                  Copy
                </Button>
                <Button
                  size="sm"
                  onClick={sendToChat}
                  disabled={!text.trim() || isStructuring}
                >
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
