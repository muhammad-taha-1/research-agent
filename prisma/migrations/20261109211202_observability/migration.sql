-- CreateEnum
CREATE TYPE "ErrorType" AS ENUM ('NETWORK_ERROR', 'RATE_LIMIT', 'PARSE_ERROR', 'CONTEXT_OVERFLOW', 'TOOL_ERROR', 'URL_BLOCKED', 'REFUSAL', 'MAX_TOKENS', 'API_ERROR');

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "errorType" "ErrorType";

-- AlterTable
ALTER TABLE "AgentStep" ADD COLUMN     "cacheReadTokens" INTEGER,
ADD COLUMN     "cacheWriteTokens" INTEGER,
ADD COLUMN     "costUsd" DOUBLE PRECISION,
ADD COLUMN     "errorType" "ErrorType",
ADD COLUMN     "model" TEXT,
ADD COLUMN     "modelDuration" INTEGER;

-- Backfill: categorize errors recorded before categories existed, from their messages
-- (the same rules the tools now apply when they fail)
UPDATE "AgentStep" SET "errorType" = CASE
  WHEN "error" LIKE 'URL not allowed%' OR "error" ~ '^HTTP (401|403|451) ' THEN 'URL_BLOCKED'
  WHEN "error" ~ '^HTTP 429 ' OR "error" LIKE 'Search rate limit%' THEN 'RATE_LIMIT'
  WHEN "error" LIKE 'Timed out%' OR "error" LIKE 'Could not reach URL%' OR "error" LIKE 'Search timed out%'
    OR "error" ~ '^HTTP 5\d\d ' THEN 'NETWORK_ERROR'
  WHEN "error" LIKE 'Invalid input for%' THEN 'PARSE_ERROR'
  ELSE 'TOOL_ERROR'
END::"ErrorType"
WHERE "status" = 'ERROR' AND "toolName" IS NOT NULL;

UPDATE "AgentRun" SET "errorType" = CASE "endReason"
  WHEN 'refusal' THEN 'REFUSAL'
  WHEN 'max_tokens' THEN 'MAX_TOKENS'
  WHEN 'parse_error' THEN 'PARSE_ERROR'
  WHEN 'api_error' THEN 'API_ERROR'
  WHEN 'consecutive_errors' THEN 'TOOL_ERROR'
END::"ErrorType"
WHERE "status" = 'ERROR' AND "endReason" IN ('refusal', 'max_tokens', 'parse_error', 'api_error', 'consecutive_errors');
