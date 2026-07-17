-- English-only UI: replace the leftover Bulgarian column defaults. These are
-- always overwritten in application code (chat sets an explicit title, the
-- prompts POST defaults the category via Zod), so no existing rows change —
-- this only fixes the latent fallback value at the DB level.

-- AlterTable
ALTER TABLE "Conversation" ALTER COLUMN "title" SET DEFAULT 'New conversation';

-- AlterTable
ALTER TABLE "Prompt" ALTER COLUMN "category" SET DEFAULT 'General';
