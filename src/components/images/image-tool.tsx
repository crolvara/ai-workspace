"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_IMAGE_MODEL_KEY, IMAGE_MODELS } from "@/lib/models";
import { cn } from "@/lib/utils";

const MAX_PROMPT_LENGTH = 2000;

interface GenerationResult {
  /** stable key — results are prepended, so an array index would shift */
  id: string;
  /** data URL — kept only in memory for this page visit */
  image: string;
  prompt: string;
  text: string;
  latencyMs: number;
}

function downloadExtension(dataUrl: string): string {
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  return mime.split("/")[1] ?? "png";
}

export function ImageTool() {
  const [prompt, setPrompt] = useState("");
  const [modelKey, setModelKey] = useState(DEFAULT_IMAGE_MODEL_KEY);
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<GenerationResult[]>([]);

  async function generate() {
    const input = prompt.trim();
    if (!input || isGenerating) return;
    setIsGenerating(true);
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: input, model: modelKey }),
      });
      const data = (await res.json().catch(() => null)) as {
        image?: string;
        text?: string;
        latencyMs?: number;
        error?: string;
      } | null;
      if (!res.ok || !data?.image) {
        toast.error(data?.error ?? "Generation failed. Try again.");
        return;
      }
      setResults((old) => [
        {
          id: crypto.randomUUID(),
          image: data.image!,
          prompt: input,
          text: data.text ?? "",
          latencyMs: data.latencyMs ?? 0,
        },
        ...old,
      ]);
    } catch {
      toast.error("Network error. Check your connection and try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void generate();
            }
          }}
          rows={3}
          placeholder="Describe the image you want to create…"
          className="resize-none"
          disabled={isGenerating}
        />
        <p className="text-right text-xs text-muted-foreground">
          {prompt.length}/{MAX_PROMPT_LENGTH}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={modelKey}
          onValueChange={(value) => {
            if (value) setModelKey(value);
          }}
        >
          <SelectTrigger className="w-60" size="sm">
            {/* Explicit child: Radix falls back to the raw value before
                the (portal-mounted) items register their labels */}
            <SelectValue placeholder="Choose a model">
              {IMAGE_MODELS.find((m) => m.key === modelKey)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {IMAGE_MODELS.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={() => void generate()}
          disabled={isGenerating || !prompt.trim()}
        >
          {isGenerating ? "Generating…" : "Generate image"}
        </Button>
      </div>

      {isGenerating && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full animate-pulse rounded-full bg-primary" />
        </div>
      )}

      {results.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {results.map((r) => (
            <figure key={r.id} className="space-y-2 rounded-lg border p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- in-memory data URL */}
              <img
                src={r.image}
                alt={r.prompt}
                className="w-full rounded-md object-contain"
              />
              <figcaption className="line-clamp-2 text-xs text-muted-foreground">
                {r.prompt}
              </figcaption>
              {r.text && <p className="text-xs text-muted-foreground">{r.text}</p>}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {(r.latencyMs / 1000).toFixed(1)} s
                </span>
                <a
                  href={r.image}
                  download={`ai-image.${downloadExtension(r.image)}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  Download
                </a>
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
