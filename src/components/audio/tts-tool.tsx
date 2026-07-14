"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import type {
  KokoroVoice,
  KokoroWorkerIn,
  KokoroWorkerOut,
} from "./kokoro-worker";

const MAX_TEXT_LENGTH = 1000;

const VOICE_OPTIONS: { id: KokoroVoice; label: string }[] = [
  { id: "af_heart", label: "Heart — female, American" },
  { id: "af_bella", label: "Bella — female, American" },
  { id: "af_nicole", label: "Nicole — female, whispering" },
  { id: "am_michael", label: "Michael — male, American" },
  { id: "am_fenrir", label: "Fenrir — male, American" },
  { id: "bf_emma", label: "Emma — female, British" },
  { id: "bm_george", label: "George — male, British" },
  { id: "bm_fable", label: "Fable — male, British" },
];

const SPEED_OPTIONS = [
  { value: "0.8", label: "0.8× — slow" },
  { value: "1", label: "1× — normal" },
  { value: "1.25", label: "1.25× — fast" },
] as const;

type Phase =
  | { name: "idle" }
  | { name: "loading"; progress: number }
  | { name: "generating" }
  | { name: "done" }
  | { name: "error"; message: string };

export function TtsTool() {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<KokoroVoice>("af_heart");
  const [speed, setSpeed] = useState("1");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("./kokoro-worker.ts", import.meta.url));
      workerRef.current.onmessage = (e: MessageEvent<KokoroWorkerOut>) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setPhase({ name: "loading", progress: msg.progress });
        } else if (msg.type === "generating") {
          setPhase({ name: "generating" });
        } else if (msg.type === "result") {
          setAudioUrl(URL.createObjectURL(msg.wav));
          setPhase({ name: "done" });
        } else {
          setPhase({ name: "error", message: msg.message });
        }
      };
    }
    return workerRef.current;
  }, []);

  function generate() {
    const input = text.trim();
    if (!input) {
      toast.error("Enter text to synthesize.");
      return;
    }
    setAudioUrl(null);
    setPhase({ name: "loading", progress: 0 });
    const message: KokoroWorkerIn = {
      type: "generate",
      text: input,
      voice,
      speed: Number(speed),
    };
    getWorker().postMessage(message);
  }

  const isBusy = phase.name === "loading" || phase.name === "generating";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Kokoro speech synthesis runs entirely in your browser. On first use a
        model (~90 MB) is downloaded and cached by the browser. For now the
        voices are <strong>English</strong> only — Kokoro does not yet support
        Bulgarian.
      </p>

      <div className="flex flex-col gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_LENGTH))}
          rows={5}
          placeholder="Enter English text to turn into speech…"
          className="resize-none"
          disabled={isBusy}
        />
        <p className="text-right text-xs text-muted-foreground">
          {text.length}/{MAX_TEXT_LENGTH}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={voice}
          onValueChange={(value) => {
            if (value) setVoice(value as KokoroVoice);
          }}
        >
          <SelectTrigger className="w-56" size="sm">
            {/* Explicit child: Radix falls back to the raw value before
                the (portal-mounted) items register their labels */}
            <SelectValue placeholder="Voice">
              {VOICE_OPTIONS.find((v) => v.id === voice)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {VOICE_OPTIONS.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={speed}
          onValueChange={(value) => {
            if (value) setSpeed(value);
          }}
        >
          <SelectTrigger className="w-40" size="sm">
            <SelectValue placeholder="Speed">
              {SPEED_OPTIONS.find((s) => s.value === speed)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SPEED_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={generate} disabled={isBusy || !text.trim()}>
          {isBusy ? "Generating…" : "Generate speech"}
        </Button>
      </div>

      {isBusy && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {phase.name === "loading"
              ? `Loading the model… ${Math.round(phase.progress * 100)}%`
              : "Generating speech…"}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full bg-primary transition-all",
                phase.name === "generating" && "animate-pulse",
              )}
              style={{
                width:
                  phase.name === "loading"
                    ? `${Math.round(phase.progress * 100)}%`
                    : "100%",
              }}
            />
          </div>
        </div>
      )}

      {phase.name === "error" && (
        <p className="text-sm text-destructive">{phase.message}</p>
      )}

      {audioUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <audio controls src={audioUrl} className="h-10 max-w-full" />
          <a
            href={audioUrl}
            download="kokoro-speech.wav"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Download WAV
          </a>
        </div>
      )}
    </div>
  );
}
