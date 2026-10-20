import { z } from "zod";
import { defineTool, ok } from "@/lib/agents/core/types";
import { prisma } from "@/lib/db/prisma";
import { toFindingView } from "@/lib/research/queries";

const TITLE_MAX = 100;

const inputSchema = z.object({
  // Over-long titles are trimmed, not rejected: the finding itself is what matters
  title: z
    .string()
    .trim()
    .min(1, "Title is empty")
    .transform((t) => (t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t)),
  content: z.string().trim().min(1, "Content is empty").max(20_000),
  source_url: z.url({ protocol: /^https?$/, error: "source_url must be a full http(s) URL" }).optional(),
  source_title: z.string().trim().max(500).optional(),
  category: z
    .string()
    .trim()
    .max(50)
    .transform((c) => c.toLowerCase().replace(/[\s-]+/g, "_"))
    .optional(),
  relevance: z.number().min(0).max(1).optional(),
});

export const saveFindingTool = defineTool({
  definition: {
    name: "save_finding",
    description:
      "Save an important finding or piece of information discovered during research. Use this to record key facts, insights, data points, or conclusions. Each finding should be a self-contained piece of knowledge with a clear title and detailed content.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: `A concise title summarizing this finding (max ${TITLE_MAX} chars)`,
        },
        content: {
          type: "string",
          description: "Detailed content of the finding. Include specific facts, numbers, quotes, and context.",
        },
        source_url: {
          type: "string",
          description: "URL where this information was found",
        },
        source_title: {
          type: "string",
          description: "Title of the source page/article",
        },
        category: {
          type: "string",
          description:
            'Category for organizing findings (e.g., "market_size", "competitors", "technical", "risks")',
        },
        relevance: {
          type: "number",
          description: "How relevant this finding is to the research question (0.0 to 1.0)",
        },
      },
      required: ["title", "content"],
    },
  },
  inputSchema,
  async execute(input, { projectId }) {
    const finding = await prisma.finding.create({
      data: {
        projectId,
        title: input.title,
        content: input.content,
        sourceUrl: input.source_url,
        sourceTitle: input.source_title,
        category: input.category || null,
        relevance: input.relevance,
      },
    });
    // The saved row, so the loop can emit it as a `finding` event as-is
    return ok(toFindingView(finding));
  },
});
