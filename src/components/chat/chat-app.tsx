"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquareText, Plus, Send, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_MODEL_KEY, MODELS, PROVIDER_LABELS, type ProviderId } from "@/lib/models";
import { CHAT_DRAFT_KEY } from "@/lib/prompts";
import { readChatStream } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
}

const PROVIDERS_IN_ORDER: ProviderId[] = ["groq", "openrouter", "gemini"];

const STARTER_PROMPTS = [
  "Explain how HTTPS works in simple terms",
  "Review this code snippet for bugs",
  "Draft a polite follow-up email",
  "Compare SQL and NoSQL databases",
];

function modelLabel(key: string | null | undefined): string {
  return MODELS.find((m) => m.key === key)?.label ?? key ?? "";
}

export function ChatApp() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [modelKey, setModelKey] = useState(DEFAULT_MODEL_KEY);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Guards openConversation against out-of-order responses on rapid clicks.
  const openSeqRef = useRef(0);

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) {
      const data = await res.json();
      setConversations(data.conversations);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshConversations();
    })();
  }, [refreshConversations]);

  // Draft handed over from the Prompt Library (/prompts → "To chat").
  // Read in an effect (not a useState initializer) so SSR markup and the
  // first client render match — sessionStorage exists only in the browser.
  useEffect(() => {
    const draft = sessionStorage.getItem(CHAT_DRAFT_KEY);
    if (draft) {
      sessionStorage.removeItem(CHAT_DRAFT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot handoff from another page; runs once on mount
      setInput(draft);
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Stop an in-flight generation when the user leaves the page.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function openConversation(id: string) {
    if (isStreaming) return;
    const seq = ++openSeqRef.current;
    const res = await fetch(`/api/conversations/${id}`);
    if (seq !== openSeqRef.current) return; // a newer click won
    if (!res.ok) {
      toast.error("The conversation could not be loaded.");
      return;
    }
    const data = await res.json();
    setActiveId(id);
    setMessages(data.conversation.messages);
    setModelKey(
      MODELS.some((m) => m.key === data.conversation.model)
        ? data.conversation.model
        : DEFAULT_MODEL_KEY,
    );
    setSidebarOpen(false);
  }

  function newConversation() {
    if (isStreaming) return;
    setActiveId(null);
    setMessages([]);
    setSidebarOpen(false);
  }

  async function deleteConversation(id: string) {
    if (isStreaming) return;
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (id === activeId) {
        setActiveId(null);
        setMessages([]);
      }
      void refreshConversations();
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  async function send() {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantId = `local-${Date.now() + 1}`;
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: "assistant", content: "", model: modelKey },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          model: modelKey,
          conversationId: activeId,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "The message could not be sent.");
      }

      for await (const event of readChatStream(res)) {
        if (event.type === "meta" && event.conversationId) {
          setActiveId(event.conversationId);
        } else if (event.type === "delta") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + event.text }
                : m,
            ),
          );
        } else if (event.type === "done") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    inputTokens: event.usage.inputTokens,
                    outputTokens: event.usage.outputTokens,
                    latencyMs: event.latencyMs,
                  }
                : m,
            ),
          );
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      // Keep partial text the user has already read; drop only empty bubbles.
      setMessages((prev) =>
        prev.some((m) => m.id === assistantId && m.content)
          ? prev
          : prev.filter((m) => m.id !== assistantId),
      );
      if (!isAbort) {
        toast.error(err instanceof Error ? err.message : "Unexpected error.");
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      void refreshConversations();
    }
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="relative flex h-full">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="absolute inset-0 z-10 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar: overlay on mobile, static column on md+ */}
      <aside
        className={cn(
          "absolute inset-y-0 left-0 z-20 flex w-64 shrink-0 flex-col border-r bg-background transition-transform md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="p-3">
          <Button
            className="w-full"
            variant="outline"
            onClick={newConversation}
            disabled={isStreaming}
          >
            <Plus className="size-4" /> New conversation
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="space-y-0.5 px-2 pb-3">
            {conversations.map((c) => (
              <li key={c.id} className="group relative">
                <button
                  onClick={() => void openConversation(c.id)}
                  disabled={isStreaming}
                  className={cn(
                    "w-full rounded-md px-2 py-2 pr-7 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60",
                    c.id === activeId && "bg-accent",
                  )}
                >
                  <span className="line-clamp-1">{c.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {modelLabel(c.model)}
                  </span>
                </button>
                <button
                  aria-label="Delete conversation"
                  onClick={() => void deleteConversation(c.id)}
                  disabled={isStreaming}
                  className="absolute right-1.5 top-2 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive max-md:block md:hidden md:group-focus-within:block md:group-hover:block"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
            {conversations.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">
                No conversations yet
              </li>
            )}
          </ul>
        </ScrollArea>
      </aside>

      {/* Chat area */}
      <section className="flex min-w-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
            {messages.length === 0 && (
              <div className="py-20 text-center">
                <div
                  aria-hidden
                  className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl bg-foreground text-background shadow-lg shadow-foreground/15"
                >
                  <MessageSquareText className="size-6" />
                </div>
                <h1 className="bg-linear-to-b from-foreground to-foreground/60 bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
                  What can I help you with?
                </h1>
                <p className="mt-2.5 text-sm text-muted-foreground">
                  Pick a model and start a conversation — free, no sign-up.
                </p>
                <div className="mx-auto mt-7 flex max-w-md flex-wrap justify-center gap-2">
                  {STARTER_PROMPTS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="rounded-full border bg-card px-3.5 py-1.5 text-xs text-muted-foreground shadow-xs transition-all hover:-translate-y-px hover:border-primary/40 hover:text-foreground hover:shadow-sm"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex flex-col gap-1",
                  m.role === "user" ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    m.role === "user"
                      ? "rounded-br-md bg-primary text-primary-foreground shadow-sm"
                      : "rounded-bl-md border bg-card shadow-xs",
                  )}
                >
                  {m.content ||
                    (isStreaming && m.role === "assistant" ? (
                      <span className="animate-pulse text-muted-foreground">
                        …
                      </span>
                    ) : (
                      ""
                    ))}
                </div>
                {m.role === "assistant" && m.latencyMs != null && (
                  <p className="px-1 text-xs text-muted-foreground">
                    {modelLabel(m.model)} · {m.inputTokens ?? 0}→
                    {m.outputTokens ?? 0} tokens ·{" "}
                    {(m.latencyMs / 1000).toFixed(1)} s
                  </p>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Composer */}
        <div className="border-t">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="md:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open the conversation list"
              >
                <MessageSquareText className="size-4" /> Chats
              </Button>
              <Select
                value={modelKey}
                onValueChange={(value) => {
                  if (value) setModelKey(value);
                }}
              >
                <SelectTrigger className="w-60 max-w-full" size="sm">
                  {/* Explicit child: Radix falls back to the raw key before
                      the (portal-mounted) items register their labels */}
                  <SelectValue placeholder="Select a model">
                    {modelLabel(modelKey)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent side="top" align="start" alignItemWithTrigger={false}>
                  {PROVIDERS_IN_ORDER.map((provider) => (
                    <SelectGroup key={provider}>
                      <SelectLabel>{PROVIDER_LABELS[provider]}</SelectLabel>
                      {MODELS.filter((m) => m.provider === provider).map(
                        (m) => (
                          <SelectItem key={m.key} value={m.key}>
                            {m.label}
                          </SelectItem>
                        ),
                      )}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {MODELS.find((m) => m.key === modelKey)?.description}
              </span>
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
                rows={2}
                className="max-h-40 resize-none"
                disabled={isStreaming}
              />
              {isStreaming ? (
                <Button variant="destructive" onClick={stopStreaming}>
                  <Square className="size-4" /> Stop
                </Button>
              ) : (
                <Button onClick={() => void send()} disabled={!input.trim()}>
                  <Send className="size-4" /> Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
