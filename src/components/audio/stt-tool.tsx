"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CHAT_DRAFT_KEY } from "@/lib/prompts";
import { decodeAudioToMono16k } from "@/lib/audio";
import { cn } from "@/lib/utils";
import type { WhisperWorkerIn, WhisperWorkerOut } from "./whisper-worker";

const MAX_FILE_MB = 25;
const MAX_RECORD_SECONDS = 300;

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "bg", label: "Bulgarian" },
  { value: "en", label: "English" },
] as const;

type Phase =
  | { name: "idle" }
  | { name: "loading"; progress: number }
  | { name: "transcribing" }
  | { name: "done" }
  | { name: "error"; message: string };

export function SttTool() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [language, setLanguage] = useState("auto");
  const [text, setText] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  // Read via ref so a recording started before a language switch still
  // transcribes with the language selected at stop time (no stale closure).
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      if (timerRef.current) clearInterval(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    };
  }, []);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("./whisper-worker.ts", import.meta.url));
      workerRef.current.onmessage = (e: MessageEvent<WhisperWorkerOut>) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setPhase({ name: "loading", progress: msg.progress });
        } else if (msg.type === "transcribing") {
          setPhase({ name: "transcribing" });
        } else if (msg.type === "result") {
          setText(msg.text);
          setPhase({ name: "done" });
          if (!msg.text) toast.info("No speech was detected in the recording.");
        } else {
          setPhase({ name: "error", message: msg.message });
        }
      };
    }
    return workerRef.current;
  }, []);

  const runTranscription = useCallback(
    async (blob: Blob) => {
      if (blob.size > MAX_FILE_MB * 1024 * 1024) {
        toast.error(`The file is too large (maximum ${MAX_FILE_MB} MB).`);
        return;
      }
      setText("");
      setPhase({ name: "loading", progress: 0 });
      let audio: Float32Array;
      try {
        audio = await decodeAudioToMono16k(blob);
      } catch {
        toast.error("The browser cannot decode this audio format.");
        setPhase({ name: "idle" });
        return;
      }
      if (audio.length === 0) {
        toast.error("The recording is empty.");
        setPhase({ name: "idle" });
        return;
      }
      const lang = languageRef.current;
      const message: WhisperWorkerIn = {
        type: "transcribe",
        audio,
        language: lang === "auto" ? null : lang,
      };
      getWorker().postMessage(message, [audio.buffer]);
    },
    [getWorker],
  );

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone unavailable. Allow access in your browser.");
      return;
    }
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      chunksRef.current = [];
      void runTranscription(blob);
    };
    recorder.start();
    recorderRef.current = recorder;
    secondsRef.current = 0;
    setRecordSeconds(0);
    setIsRecording(true);
    timerRef.current = setInterval(() => {
      secondsRef.current += 1;
      setRecordSeconds(secondsRef.current);
      if (secondsRef.current >= MAX_RECORD_SECONDS) stopRecording();
    }, 1000);
  }, [runTranscription, stopRecording]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void onFile(file);
  }

  async function onFile(file: File) {
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
      toast.error("Choose an audio file (MP3, WAV, OGG, M4A, WebM…).");
      return;
    }
    await runTranscription(file);
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

  const isBusy = phase.name === "loading" || phase.name === "transcribing";
  const recordLabel = `${String(Math.floor(recordSeconds / 60)).padStart(1, "0")}:${String(recordSeconds % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Dictate or upload an audio file — Whisper recognition runs entirely in
        your browser, the audio never leaves your computer. On first use a
        model (~80 MB) is downloaded and cached by the browser.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={language}
          onValueChange={(value) => {
            if (value) setLanguage(value);
          }}
        >
          <SelectTrigger className="w-44" size="sm">
            {/* Explicit child: Radix falls back to the raw value before
                the (portal-mounted) items register their labels */}
            <SelectValue placeholder="Language">
              {LANGUAGE_OPTIONS.find((o) => o.value === language)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={isRecording ? "destructive" : "default"}
          disabled={isBusy}
          onClick={() => (isRecording ? stopRecording() : void startRecording())}
        >
          {isRecording ? `■ Stop recording (${recordLabel})` : "● Record from microphone"}
        </Button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        onClick={() => !isBusy && !isRecording && inputRef.current?.click()}
        className={cn(
          "flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          isDragOver ? "border-primary bg-primary/5" : "hover:bg-accent/50",
          (isBusy || isRecording) && "pointer-events-none opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
            e.target.value = "";
          }}
        />
        <p className="text-sm font-medium">
          Drop an audio file here or click to browse
        </p>
        <p className="text-xs text-muted-foreground">
          MP3, WAV, OGG, M4A, WebM · up to {MAX_FILE_MB} MB · recording up to{" "}
          {MAX_RECORD_SECONDS / 60} min
        </p>
      </div>

      {isBusy && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {phase.name === "loading"
              ? `Loading the model… ${Math.round(phase.progress * 100)}%`
              : "Recognizing speech…"}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full bg-primary transition-all",
                phase.name === "transcribing" && "animate-pulse",
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

      {(text || phase.name === "done") && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="The recognized text will appear here"
            className="resize-none"
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
      )}
    </div>
  );
}
