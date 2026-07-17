"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MODELS, PROVIDER_LABELS } from "@/lib/models";
import { readChatStream } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

const MAX_SELECTED = 3;

interface CompareResult {
  content: string;
  status: "streaming" | "done" | "aborted" | "error";
  latencyMs?: number;
  outputTokens?: number;
  error?: string;
}

export default function ComparePage() {
  const [selected, setSelected] = useState<string[]>([
    "groq/llama-3.3-70b",
    "gemini/2.5-flash",
  ]);
  const [prompt, setPrompt] = useState("");
  const [results, setResults] = useState<Record<string, CompareResult>>({});
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Ensure the session cookie exists before the parallel /api/chat calls —
  // otherwise a first visit races to create several sessions at once.
  useEffect(() => {
    void fetch("/api/session").catch(() => {});
    return () => abortRef.current?.abort();
  }, []);

  function toggleModel(key: string) {
    setSelected((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX_SELECTED) {
        toast.info(`You can compare up to ${MAX_SELECTED} models.`);
        return prev;
      }
      return [...prev, key];
    });
  }

  async function runOne(modelKey: string, text: string, signal: AbortSignal) {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, model: modelKey, ephemeral: true }),
        signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Request failed.");
      }
      for await (const event of readChatStream(res)) {
        if (event.type === "delta") {
          setResults((prev) => ({
            ...prev,
            [modelKey]: {
              ...prev[modelKey]!,
              content: prev[modelKey]!.content + event.text,
            },
          }));
        } else if (event.type === "done") {
          setResults((prev) => ({
            ...prev,
            [modelKey]: {
              ...prev[modelKey]!,
              status: "done",
              latencyMs: event.latencyMs,
              outputTokens: event.usage.outputTokens,
            },
          }));
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      setResults((prev) => ({
        ...prev,
        [modelKey]: {
          ...prev[modelKey]!,
          status: isAbort ? "aborted" : "error",
          error: isAbort
            ? undefined
            : err instanceof Error
              ? err.message
              : "Unexpected error.",
        },
      }));
    }
  }

  async function run() {
    const text = prompt.trim();
    if (!text || selected.length === 0 || isRunning) return;

    setIsRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    setResults(
      Object.fromEntries(
        selected.map((key) => [key, { content: "", status: "streaming" }]),
      ),
    );
    await Promise.all(selected.map((key) => runOne(key, text, controller.signal)));
    abortRef.current = null;
    setIsRunning(false);
  }

  function stop() {
    abortRef.current?.abort();
  }

  const resultEntries = Object.entries(results);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Model comparison
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Send the same prompt to several models at once. Responses here are
            not saved to your history.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {MODELS.map((m) => (
            <button
              key={m.key}
              onClick={() => toggleModel(m.key)}
              disabled={isRunning}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                selected.includes(m.key)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {m.label}
              <span className="ml-1 opacity-60">
                {PROVIDER_LABELS[m.provider]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="For example: Explain the difference between REST and GraphQL with 3 advantages each."
            rows={3}
            className="resize-none"
            disabled={isRunning}
          />
          {isRunning ? (
            <Button variant="destructive" onClick={stop}>
              <Square className="size-4" /> Stop
            </Button>
          ) : (
            <Button
              onClick={() => void run()}
              disabled={!prompt.trim() || selected.length === 0}
            >
              Compare
            </Button>
          )}
        </div>

        {resultEntries.length > 0 && (
          <div
            className={cn(
              "grid gap-3",
              resultEntries.length === 2 && "md:grid-cols-2",
              resultEntries.length >= 3 && "md:grid-cols-3",
            )}
          >
            {resultEntries.map(([key, r]) => {
              const model = MODELS.find((m) => m.key === key);
              return (
                <Card key={key} className="min-w-0">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-sm">
                      <span>{model?.label ?? key}</span>
                      {r.status === "streaming" && (
                        <Badge variant="secondary" className="animate-pulse">
                          writing…
                        </Badge>
                      )}
                      {r.status === "done" && (
                        <Badge variant="outline">
                          {((r.latencyMs ?? 0) / 1000).toFixed(1)} s ·{" "}
                          {r.outputTokens ?? 0} tok.
                        </Badge>
                      )}
                      {r.status === "aborted" && (
                        <Badge variant="secondary">stopped</Badge>
                      )}
                      {r.status === "error" && (
                        <Badge variant="destructive">error</Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {r.content || (r.status === "streaming" ? "…" : "")}
                      {r.status === "error" && (
                        <p className={cn("text-destructive", r.content && "mt-2")}>
                          {r.error}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
