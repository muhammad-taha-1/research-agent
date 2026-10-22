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

  const run = await prisma.agentRun.findFirstOrThrow({
    where: { projectId: project.id },
    orderBy: { startedAt: "desc" },
    include: { _count: { select: { steps: { where: { toolName: { not: null } } } } } },
  });
  const findings = await prisma.finding.count({ where: { projectId: project.id } });
  console.log(
    `\n${run.status} (${run.endReason}) after ${run._count.steps} tool calls (${run.totalSearches} searches, ${run.totalPagesRead} reads, ${findings} findings), ` +
      `${Math.round((Date.now() - startedAt) / 1000)}s, $${run.costUsd.toFixed(4)}`,
  );
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
