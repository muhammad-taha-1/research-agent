// Runs one researcher round from the terminal, without the UI or a worker:
//
//   npx tsx --env-file=.env.local --tsconfig ./tsconfig.json scripts/run-agent.ts "your question" [QUICK|STANDARD|DEEP] [focus area]...
//
// Creates a project (owned by the first user in the database, so it shows up on
// the dashboard), runs the researcher, and prints every event.

import { AgentMemory } from "@/lib/agents/core/memory";
import { runAgentLoop } from "@/lib/agents/core/loop";
import type { AgentEvent, AgentState } from "@/lib/agents/core/types";
import { buildInitialMessage, createResearcherConfig } from "@/lib/agents/researcher";
import { prisma } from "@/lib/db/prisma";
import { DEPTHS, titleFromQuery } from "@/lib/research/config";
import { createToolRegistry } from "@/lib/tools";
import type { ResearchDepth } from "@/generated/prisma/enums";

function log(e: AgentEvent) {
  const d = e.data;
  switch (e.type) {
    case "step_complete": {
      const detail = d.reasoning ?? JSON.stringify(d.toolInput);
      const line = String(detail).replace(/\s+/g, " ").slice(0, 160);
      const tokens = d.inputTokens ? `  [${d.inputTokens} in / ${d.outputTokens} out]` : "";
      console.log(`#${d.stepNumber} ${d.type}${d.status === "ERROR" ? " ✗" : ""}  ${line}${tokens}`);
      if (d.error) console.log(`    error: ${d.error}`);
      break;
    }
    case "usage":
      console.log(
        `   $${d.costUsd.toFixed(4)} total · cache read ${d.cacheReadTokens} / write ${d.cacheWriteTokens} / uncached ${d.inputTokens}`,
      );
      break;
    case "thinking":
    case "tool_call":
    case "finding":
    case "plan_update":
      break; // step_complete shows the same thing once it's done
    default:
      console.log(`[${e.type}]`, JSON.stringify(d));
  }
}

async function main() {
  const [query, depthArg = "QUICK", ...focusAreas] = process.argv.slice(2);
  const depth = depthArg.toUpperCase() as ResearchDepth;
  if (!query || !DEPTHS.includes(depth)) {
    console.error('Usage: scripts/run-agent.ts "research question" [QUICK|STANDARD|DEEP] [focus area]...');
    process.exit(1);
  }

  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("No users yet: sign in through the app once first");

  const project = await prisma.researchProject.create({
    data: { title: titleFromQuery(query), query, depth, focusAreas, status: "RESEARCHING", userId: user.id },
  });
  const tools = createToolRegistry();
  const config = createResearcherConfig(depth, tools);
  const run = await prisma.agentRun.create({
    data: { projectId: project.id, agentRole: "RESEARCHER", model: config.model },
  });
  console.log(`Project ${project.id} · run ${run.id} · ${depth}\n`);

  const state: AgentState = {
    projectId: project.id,
    runId: run.id,
    userId: user.id,
    messages: [buildInitialMessage(project)],
    memory: new AgentMemory(),
    stepNumber: 0,
    toolCalls: 0,
    costUsd: 0,
    startedAt: Date.now(),
    consecutiveErrors: 0,
    doneRequested: false,
  };

  const outcome = await runAgentLoop(config, state, tools, async (e) => log(e));

  const status = outcome === "ERROR" ? "ERROR" : outcome === "STOPPED" ? "STOPPED" : "COMPLETED";
  await prisma.researchProject.update({ where: { id: project.id }, data: { status } });
  const { searchQueries, readUrls, findings } = state.memory.toJSON();
  console.log(
    `\n${outcome} after ${state.toolCalls} tool calls (${searchQueries.length} searches, ${readUrls.length} reads, ${findings.length} findings), ` +
      `${Math.round((Date.now() - state.startedAt) / 1000)}s, $${state.costUsd.toFixed(4)}`,
  );
  console.log(`Open: ${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/research/${project.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
