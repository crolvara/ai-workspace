/**
 * Prompt template helpers + built-in templates.
 *
 * Templates use {{variable}} placeholders. Built-ins are code (not DB rows) —
 * user-created prompts live in the Prompt table, scoped per session.
 */

export interface PromptTemplate {
  id: string;
  title: string;
  content: string;
  category: string;
  /** true = shipped with the app, read-only */
  builtin: boolean;
}

/** sessionStorage key for handing a filled template from /prompts to the chat composer */
export const CHAT_DRAFT_KEY = "aiw_prompt_draft";

const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function extractVariables(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    names.add(match[1]!);
  }
  return [...names];
}

export function fillTemplate(
  content: string,
  values: Record<string, string>,
): string {
  return content.replace(
    VARIABLE_PATTERN,
    (whole, name: string) => values[name]?.trim() || whole,
  );
}

export const BUILTIN_PROMPTS: PromptTemplate[] = [
  {
    id: "builtin-summarize",
    title: "Summarize text",
    category: "Writing",
    builtin: true,
    content:
      "Summarize the following text in {{number of sentences}} sentences. Keep only the essentials and do not add any new information:\n\n{{text}}",
  },
  {
    id: "builtin-rewrite-tone",
    title: "Rewrite in a different tone",
    category: "Writing",
    builtin: true,
    content:
      "Rewrite the following text in a {{tone}} tone (e.g. formal, friendly, persuasive), preserving its meaning and length:\n\n{{text}}",
  },
  {
    id: "builtin-email",
    title: "Business email",
    category: "Writing",
    builtin: true,
    content:
      "Write a short business email to {{recipient}} about {{topic}}. Keep the tone polite and professional, under 120 words, and include a subject line.",
  },
  {
    id: "builtin-code-review",
    title: "Code review",
    category: "Code",
    builtin: true,
    content:
      "Review the following code. Point out bugs, security issues, performance problems and readability concerns, ordered by severity. Suggest concrete fixes with code:\n\n```\n{{code}}\n```",
  },
  {
    id: "builtin-explain-code",
    title: "Explain code",
    category: "Code",
    builtin: true,
    content:
      "Explain what the following code does, step by step, as if you were explaining it to a junior developer. Finish with any potential problems:\n\n```\n{{code}}\n```",
  },
  {
    id: "builtin-sql",
    title: "SQL query from a description",
    category: "Code",
    builtin: true,
    content:
      "Write a PostgreSQL query that: {{query description}}.\n\nTable schema:\n{{schema}}\n\nBriefly explain what the query does.",
  },
  {
    id: "builtin-translate",
    title: "Translate",
    category: "Translation",
    builtin: true,
    content:
      "Translate the following text into {{language}}. Preserve the style and formatting, and do not add explanations:\n\n{{text}}",
  },
  {
    id: "builtin-explain-simple",
    title: "Explain it simply",
    category: "Learning",
    builtin: true,
    content:
      "Explain {{topic}} in simple terms, as if I were {{age}} years old. Use an everyday analogy and finish with a short example.",
  },
  {
    id: "builtin-quiz",
    title: "Self-check quiz",
    category: "Learning",
    builtin: true,
    content:
      "Create a quiz of {{number of questions}} questions, each with 4 possible answers, on the topic “{{topic}}”. Mark the correct answer after each question and explain in one sentence why it is correct.",
  },
  {
    id: "builtin-social-post",
    title: "Social media post",
    category: "Marketing",
    builtin: true,
    content:
      "Write {{number of variants}} variants of a short post for {{platform}} (e.g. LinkedIn, Facebook, Instagram) presenting {{product or topic}}. Give each variant a different angle: informative, provocative, and one that asks the audience a question.",
  },
];

export const BUILTIN_CATEGORIES = [
  ...new Set(BUILTIN_PROMPTS.map((p) => p.category)),
];
