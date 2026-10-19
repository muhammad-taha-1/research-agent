import { z } from "zod";
import {
  DEPTHS,
  FOCUS_AREA_MAX_LENGTH,
  FOCUS_AREAS_MAX,
  INSTRUCTION_MAX,
  QUERY_MAX,
  QUERY_MIN,
} from "./config";

export const createResearchSchema = z.object({
  query: z
    .string()
    .trim()
    .min(QUERY_MIN, `Describe your question in at least ${QUERY_MIN} characters`)
    .max(QUERY_MAX),
  depth: z.enum(DEPTHS as [string, ...string[]]).default("STANDARD"),
  focusAreas: z
    .array(z.string().trim().max(FOCUS_AREA_MAX_LENGTH))
    .max(FOCUS_AREAS_MAX)
    .default([])
    .transform((areas) => areas.filter(Boolean)),
});

export const redirectSchema = z.object({
  instruction: z.string().trim().min(1, "Instruction is empty").max(INSTRUCTION_MAX),
});
