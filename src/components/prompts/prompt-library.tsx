"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  BUILTIN_PROMPTS,
  CHAT_DRAFT_KEY,
  extractVariables,
  fillTemplate,
  type PromptTemplate,
} from "@/lib/prompts";
import { cn } from "@/lib/utils";

interface EditorState {
  id: string | null; // null = create
  title: string;
  category: string;
  content: string;
}

const EMPTY_EDITOR: EditorState = {
  id: null,
  title: "",
  category: "General",
  content: "",
};

export function PromptLibrary() {
  const router = useRouter();
  const [userPrompts, setUserPrompts] = useState<PromptTemplate[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [usePrompt, setUsePrompt] = useState<PromptTemplate | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {},
  );

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/prompts");
      if (res.ok) {
        const data = await res.json();
        setUserPrompts(
          data.prompts.map(
            (p: Omit<PromptTemplate, "builtin">): PromptTemplate => ({
              ...p,
              builtin: false,
            }),
          ),
        );
      }
    })();
  }, []);

  const allPrompts = useMemo(
    () => [...userPrompts, ...BUILTIN_PROMPTS],
    [userPrompts],
  );

  const categories = useMemo(
    () => [...new Set(allPrompts.map((p) => p.category))],
    [allPrompts],
  );

  const visible = allPrompts.filter((p) => {
    if (category && p.category !== category) return false;
    if (!search) return true;
    const needle = search.toLowerCase();
    return (
      p.title.toLowerCase().includes(needle) ||
      p.content.toLowerCase().includes(needle)
    );
  });

  function openUseDialog(prompt: PromptTemplate) {
    setUsePrompt(prompt);
    setVariableValues({});
  }

  function sendToChat() {
    if (!usePrompt) return;
    const text = fillTemplate(usePrompt.content, variableValues);
    sessionStorage.setItem(CHAT_DRAFT_KEY, text);
    router.push("/");
  }

  async function saveEditor() {
    if (!editor || isSaving) return;
    setIsSaving(true);
    try {
      const payload = {
        title: editor.title,
        category: editor.category || "General",
        content: editor.content,
      };
      const res = await fetch(
        editor.id ? `/api/prompts/${editor.id}` : "/api/prompts",
        {
          method: editor.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Saving failed.");
      }
      const saved: PromptTemplate = { ...data.prompt, builtin: false };
      setUserPrompts((prev) =>
        editor.id
          ? prev.map((p) => (p.id === saved.id ? saved : p))
          : [saved, ...prev],
      );
      setEditor(null);
      toast.success(editor.id ? "Prompt updated." : "Prompt created.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deletePrompt(id: string) {
    const res = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
    if (res.ok) {
      setUserPrompts((prev) => prev.filter((p) => p.id !== id));
      toast.success("Prompt deleted.");
    } else {
      toast.error("Deleting failed.");
    }
  }

  const useVariables = usePrompt ? extractVariables(usePrompt.content) : [];
  const preview = usePrompt
    ? fillTemplate(usePrompt.content, variableValues)
    : "";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Prompt Library
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ready-made templates with variables like{" "}
              <code className="rounded bg-muted px-1">{"{{topic}}"}</code> —
              fill them in and continue in the chat. Your prompts are tied to
              this browser — no sign-up.
            </p>
          </div>
          <Button onClick={() => setEditor(EMPTY_EDITOR)}>+ New prompt</Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-8 w-56"
          />
          <button
            onClick={() => setCategory(null)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              category === null
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent",
            )}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c === category ? null : c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                c === category
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => {
            const variables = extractVariables(p.content);
            return (
              <Card
                key={p.id}
                className="flex flex-col gap-3 py-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5"
              >
                <CardHeader className="px-4">
                  <CardTitle className="flex items-start justify-between gap-2 text-sm">
                    <span>{p.title}</span>
                    <Badge variant={p.builtin ? "secondary" : "outline"}>
                      {p.builtin ? p.category : `${p.category} · mine`}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 px-4">
                  <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                    {p.content}
                  </p>
                  {variables.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {variables.map((v) => (
                        <Badge
                          key={v}
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {v}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
                <CardFooter className="gap-2 px-4">
                  <Button size="sm" onClick={() => openUseDialog(p)}>
                    Use
                  </Button>
                  {!p.builtin && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditor({
                            id: p.id,
                            title: p.title,
                            category: p.category,
                            content: p.content,
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => void deletePrompt(p.id)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </CardFooter>
              </Card>
            );
          })}
          {visible.length === 0 && (
            <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
              No prompts match the filter.
            </p>
          )}
        </div>
      </div>

      {/* Use dialog — fill variables, preview, send to chat */}
      <Dialog
        open={usePrompt !== null}
        onOpenChange={(open) => !open && setUsePrompt(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{usePrompt?.title}</DialogTitle>
            {useVariables.length > 0 && (
              <DialogDescription>
                Fill in the variables — empty ones stay as placeholders.
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-3">
            {useVariables.map((name) => (
              <div key={name} className="space-y-1">
                <label className="text-xs font-medium">{name}</label>
                <Input
                  value={variableValues[name] ?? ""}
                  onChange={(e) =>
                    setVariableValues((prev) => ({
                      ...prev,
                      [name]: e.target.value,
                    }))
                  }
                  placeholder={name}
                />
              </div>
            ))}
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="whitespace-pre-wrap text-xs leading-relaxed">
                {preview}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUsePrompt(null)}>
              Cancel
            </Button>
            <Button onClick={sendToChat}>To chat →</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / edit dialog */}
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editor?.id ? "Edit prompt" : "New prompt"}
            </DialogTitle>
            <DialogDescription>
              Use {"{{variable}}"} for the parts you want to fill in on each
              use.
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Title</label>
                <Input
                  value={editor.title}
                  onChange={(e) =>
                    setEditor({ ...editor, title: e.target.value })
                  }
                  maxLength={120}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Category</label>
                <Input
                  value={editor.category}
                  onChange={(e) =>
                    setEditor({ ...editor, category: e.target.value })
                  }
                  maxLength={40}
                  list="prompt-categories"
                />
                <datalist id="prompt-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Content</label>
                <Textarea
                  value={editor.content}
                  onChange={(e) =>
                    setEditor({ ...editor, content: e.target.value })
                  }
                  rows={8}
                  maxLength={8000}
                  placeholder={"e.g. Explain {{topic}} in simple terms…"}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveEditor()}
              disabled={isSaving || !editor?.title.trim() || !editor?.content.trim()}
            >
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
