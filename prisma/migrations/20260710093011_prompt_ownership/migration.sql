/*
  Warnings:

  - Added the required column `sessionId` to the `Prompt` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Prompt_category_idx";

-- AlterTable
ALTER TABLE "Prompt" ADD COLUMN     "sessionId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Prompt_sessionId_updatedAt_idx" ON "Prompt"("sessionId", "updatedAt" DESC);

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
