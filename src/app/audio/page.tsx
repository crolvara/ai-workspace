import type { Metadata } from "next";
import { SttTool } from "@/components/audio/stt-tool";
import { TtsTool } from "@/components/audio/tts-tool";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export const metadata: Metadata = {
  title: "Audio — AI Workspace",
  description: "Speech to text (Whisper) and text to speech (Kokoro), fully in the browser",
};

export default function AudioPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Audio — speech and voice
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kokoro (text to speech) and Whisper (speech to text) run entirely
            in your browser — no external services.
          </p>
        </div>
        <Tabs defaultValue="tts">
          <TabsList>
            <TabsTrigger value="tts">Text to speech</TabsTrigger>
            <TabsTrigger value="stt">Speech to text</TabsTrigger>
          </TabsList>
          <TabsContent value="tts">
            <TtsTool />
          </TabsContent>
          <TabsContent value="stt">
            <SttTool />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
