// Runs a research project from the terminal, in this process instead of a worker:
//
//   npx tsx --env-file=.env.local --tsconfig ./tsconfig.json scripts/run-agent.ts "your question" [QUICK|STANDARD|DEEP] [focus area]...
//
// Creates a project (owned by the first user in the database, so it shows up on
// the dashboard), runs it through the same orchestrator a worker job uses, and
// prints every event. Needs Redis for the control flags.

import type { AgentEvent } from "@/lib/agents/core/types";
import { orchestrateResearch } from "@/lib/agents/orchestrator";
import { prisma } from "@/lib/db/prisma";
import { redis } from "@/lib/queue/connection";
import { DEPTHS, titleFromQuery } from "@/lib/research/config";
import { describeEvent } from "@/lib/stream/events";
import type { ResearchDepth } from "@/generated/prisma/enums";

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
    data: { title: titleFromQuery(query), query, depth, focusAreas, status: "QUEUED", userId: user.id },
  });
  console.log(`Project ${project.id} · ${depth}\n`);

  const startedAt = Date.now();
  await orchestrateResearch(project.id, async (e: AgentEvent) => {
    const line = describeEvent(e);
    if (line) console.log(line);
  });

  // One line per agent run (researcher rounds, critic reviews, writer), then the total
  const runs = await prisma.agentRun.findMany({
    where: { projectId: project.id },
    orderBy: { startedAt: "asc" },
    include: { _count: { select: { steps: { where: { toolName: { not: null } } } } } },
  });
  console.log("");
  for (const run of runs) {
    const work = run.agentRole === "RESEARCHER" ? ` · ${run._count.steps} tool calls, ${run.totalSearches} searches, ${run.totalPagesRead} reads` : "";
    const secs = run.completedAt ? Math.round((run.completedAt.getTime() - run.startedAt.getTime()) / 1000) : "?";
    console.log(`${run.agentRole} r${run.round}: ${run.status} (${run.endReason})${work} · ${secs}s · $${run.costUsd.toFixed(4)}`);
  }
  const { status } = await prisma.researchProject.findUniqueOrThrow({ where: { id: project.id } });
  const findings = await prisma.finding.count({ where: { projectId: project.id } });
  const cost = runs.reduce((sum, r) => sum + r.costUsd, 0);
  console.log(`\n${status}: ${findings} findings, ${Math.round((Date.now() - startedAt) / 1000)}s, $${cost.toFixed(4)}`);
  console.log(`Open: ${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/research/${project.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    redis.disconnect();
    await prisma.$disconnect();
  });
