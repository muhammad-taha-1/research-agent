import { CircleAlert, PlugZap, ServerOff, Unplug } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { REDIS_UNAVAILABLE } from "@/lib/research/config";
import type { ProjectStatus } from "@/generated/prisma/enums";
import type { JobHealth, RunSummaryView } from "@/types/research";

interface Props {
  status: ProjectStatus;
  runs: RunSummaryView[];
  findingCount: number;
  health: JobHealth | null;
}

/** Why the research isn't moving when it should be, or why it ended badly, and what to do about it. */
export function RunNotice({ status, runs, findingCount, health }: Props) {
  const lastResearcher = runs.findLast((r) => r.agentRole === "RESEARCHER");
  const kept =
    findingCount > 0
      ? `The ${findingCount} ${findingCount === 1 ? "finding" : "findings"} saved so far ${findingCount === 1 ? "is" : "are"} kept.`
      : "";

  if (status === "ERROR") {
    const failed = runs.findLast((r) => r.status === "ERROR" && r.agentRole === "RESEARCHER");
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Research failed</AlertTitle>
        <AlertDescription>
          <p className="font-mono text-xs break-words">{failed?.error ?? "The agent stopped on an error."}</p>
          <p className="text-muted-foreground">
            {kept}
            {findingCount > 0 ? " You can still generate a report from them." : " Nothing was saved before it failed."}
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (status === "PAUSED" && lastResearcher?.status === "PAUSED" && lastResearcher.endReason === REDIS_UNAVAILABLE) {
    return (
      <Alert>
        <Unplug />
        <AlertTitle>Paused automatically: the connection to Redis was lost</AlertTitle>
        <AlertDescription>
          Without Redis, nobody could pause, stop, or follow the agent, so it paused at its last checkpoint. {kept} Resume
          once Redis is back.
        </AlertDescription>
      </Alert>
    );
  }

  if (!health) return null;
  if (!health.redis) {
    return (
      <Alert>
        <Unplug />
        <AlertTitle>Can&apos;t reach Redis</AlertTitle>
        <AlertDescription>
          Live updates and controls are unavailable. A running agent pauses itself at its next step and can be resumed
          once Redis is back.
        </AlertDescription>
      </Alert>
    );
  }
  if (health.stuck) {
    return (
      <Alert>
        <PlugZap />
        <AlertTitle>This research isn&apos;t running</AlertTitle>
        <AlertDescription>
          Its status says it&apos;s running, but no job is working on it (the job was lost, for example when Redis
          restarted without its data). Resume continues from the last checkpoint.
        </AlertDescription>
      </Alert>
    );
  }
  if (health.job && !health.workerAlive) {
    return (
      <Alert>
        <ServerOff />
        <AlertTitle>No worker is running</AlertTitle>
        <AlertDescription>
          The research is {health.job === "active" ? "on hold" : "queued"} until a worker picks it up. Start one with{" "}
          <code className="font-mono text-xs">npm run worker</code>; it continues from the last checkpoint.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
