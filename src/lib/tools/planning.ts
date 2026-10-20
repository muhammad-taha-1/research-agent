import { z } from "zod";
import { defineTool, ok } from "@/lib/agents/core/types";

// Both tools are the agent organizing its own work: they change nothing outside
// the conversation. The loop reads their results — update_plan feeds memory and
// the `plan_update` event, evaluate_progress with should_continue: false ends the run.

const items = z.array(z.string().trim().min(1).max(500)).max(30);

const planSchema = z.object({
  completed: items.default([]),
  in_progress: z.string().trim().max(500).optional(),
  remaining: items,
  gaps: items.default([]),
});

export type ResearchPlanInput = z.infer<typeof planSchema>;

export const updatePlanTool = defineTool({
  definition: {
    name: "update_plan",
    description:
      "Create or update the research plan. Use this to track what has been researched, what is being researched now, what remains, and what knowledge gaps have been identified. Call this at the start of research and whenever the plan needs adjustment.",
    input_schema: {
      type: "object",
      properties: {
        completed: {
          type: "array",
          items: { type: "string" },
          description: "Research tasks already completed",
        },
        in_progress: {
          type: "string",
          description: "What is currently being researched",
        },
        remaining: {
          type: "array",
          items: { type: "string" },
          description: "Research tasks still to do",
        },
        gaps: {
          type: "array",
          items: { type: "string" },
          description: "Knowledge gaps identified that need more research",
        },
      },
      required: ["remaining"],
    },
  },
  inputSchema: planSchema,
  async execute(plan) {
    return ok({ ...plan, in_progress: plan.in_progress || null });
  },
});

const evaluationSchema = z.object({
  assessment: z.string().trim().min(1, "Assessment is empty").max(2000),
  coverage_score: z.number().min(0).max(1),
  should_continue: z.boolean(),
  reason: z.string().trim().min(1, "Reason is empty").max(2000),
});

export const evaluateProgressTool = defineTool({
  definition: {
    name: "evaluate_progress",
    description:
      "Evaluate the current research progress. Assess whether enough information has been gathered to answer the research question comprehensively. Use this periodically to decide whether to continue searching or move to report generation.",
    input_schema: {
      type: "object",
      properties: {
        assessment: {
          type: "string",
          description: "Brief assessment of current research coverage",
        },
        coverage_score: {
          type: "number",
          description: "Estimated coverage of the research question (0.0 to 1.0)",
        },
        should_continue: {
          type: "boolean",
          description: "Whether more research is needed",
        },
        reason: {
          type: "string",
          description: "Why the agent should or should not continue",
        },
      },
      required: ["assessment", "coverage_score", "should_continue", "reason"],
    },
  },
  inputSchema: evaluationSchema,
  async execute(evaluation) {
    return ok({
      ...evaluation,
      next: evaluation.should_continue
        ? "Continue researching the remaining items and gaps."
        : "Research marked complete. Finish with a brief summary of what was found.",
    });
  },
});
