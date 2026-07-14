import { z } from "zod";

const promptFields = {
  title: z.string().trim().min(1, "Title is required.").max(120),
  content: z.string().trim().min(1, "Content is required.").max(8000),
  category: z.string().trim().min(1).max(40),
};

export const promptInputSchema = z.object({
  ...promptFields,
  category: promptFields.category.default("General"),
});

// Built from the default-less fields: `.partial()` over a field with
// `.default()` still injects the default for missing keys (Zod v4), which
// would silently reset the category on every PATCH that omits it.
export const promptUpdateSchema = z.object(promptFields).partial();
