export type ChatStreamEvent =
  | { type: "meta"; conversationId: string | null; model: string }
  | { type: "delta"; text: string }
  | {
      type: "done";
      usage: { inputTokens: number; outputTokens: number };
      latencyMs: number;
      conversationId: string | null;
    }
  | { type: "error"; message: string };

/** Parses the SSE body produced by /api/chat into typed events. */
export async function* readChatStream(
  response: Response,
): AsyncGenerator<ChatStreamEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const dataLine = rawEvent
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      try {
        yield JSON.parse(dataLine.slice(6)) as ChatStreamEvent;
      } catch {
        // ignore malformed frames
      }
    }
  }
}
