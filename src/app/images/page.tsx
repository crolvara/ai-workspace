import type { Metadata } from "next";
import { ImageTool } from "@/components/images/image-tool";

export const metadata: Metadata = {
  title: "Images — AI Workspace",
  description: "Image generation with the free Google Gemini models",
};

export default function ImagesPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Image generation
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create an image from a text description with the free Google Gemini
            image models. Generated images are not stored on the server —
            download them if you want to keep them.
          </p>
        </div>
        <ImageTool />
      </div>
    </div>
  );
}
