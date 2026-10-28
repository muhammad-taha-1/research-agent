"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, CornerDownRight, Loader2, Pause, Play, Send, Square } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ACTIVE_STATUSES, INSTRUCTION_MAX, TERMINAL_STATUSES } from "@/lib/research/config";
import type { ProjectStatus } from "@/generated/prisma/enums";
import type { RedirectView } from "@/types/research";

interface Props {
  projectId: string;
  status: ProjectStatus;
  findingCount: number;
  redirects: RedirectView[];
}

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function AgentControls({ projectId, status, findingCount, redirects }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"start" | "pause" | "resume" | "stop" | "redirect" | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  // Pause and stop take effect at the agent's next step boundary; until the status
  // changes, show that the request is in
  const [requested, setRequested] = useState<"pause" | "stop" | null>(null);
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (!ACTIVE_STATUSES.includes(status)) setRequested(null);
  }

  const terminal = TERMINAL_STATUSES.includes(status);
  const active = ACTIVE_STATUSES.includes(status);
  const canPause = active && status !== "QUEUED";
  const paused = status === "PAUSED";
  const pausing = requested === "pause" && active;
  const stopping = requested === "stop" && active;

  // "Applied" for instructions that were still pending while this page was open
  const pendingIds = useRef(new Set(redirects.filter((r) => !r.appliedAt).map((r) => r.id)));
  useEffect(() => {
    for (const r of redirects) {
      if (!r.appliedAt) pendingIds.current.add(r.id);
      else if (pendingIds.current.delete(r.id)) toast.success("Instruction applied", { description: r.instruction });
    }
  }, [redirects]);

  async function run(action: NonNullable<typeof busy>, fn: () => Promise<void>) {
    setBusy(action);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const base = `/api/research/${projectId}`;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === "CREATED" ? (
          <Button
            disabled={busy !== null}
            onClick={() => run("start", async () => void (await post(`${base}/start`)))}
          >
            {busy === "start" ? <Loader2 className="animate-spin" /> : <Play />}
            Start research
          </Button>
        ) : paused ? (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => run("resume", async () => void (await post(`${base}/resume`)))}
          >
            {busy === "resume" ? <Loader2 className="animate-spin" /> : <Play />}
            Resume
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={!canPause || pausing || stopping || busy !== null}
            onClick={() =>
              run("pause", async () => {
                await post(`${base}/pause`);
                setRequested("pause");
              })
            }
          >
            {busy === "pause" || pausing ? <Loader2 className="animate-spin" /> : <Pause />}
            {pausing ? "Pausing…" : "Pause"}
          </Button>
        )}

        <Dialog open={stopOpen} onOpenChange={setStopOpen}>
          <DialogTrigger render={<Button variant="destructive" disabled={terminal || stopping || busy !== null} />}>
            {stopping ? <Loader2 className="animate-spin" /> : <Square />}
            {stopping ? "Stopping…" : "Stop"}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Stop this research?</DialogTitle>
              <DialogDescription>
                {findingCount > 0
                  ? `The agent has found ${findingCount} ${findingCount === 1 ? "finding" : "findings"} so far. `
                  : ""}
                Everything found so far is kept, and you can still generate a report.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Keep going</DialogClose>
              <Button
                variant="destructive"
                disabled={busy !== null}
                onClick={() =>
                  run("stop", async () => {
                    const { status } = await post(`${base}/stop`);
                    setStopOpen(false);
                    if (status === "STOPPING") {
                      setRequested("stop");
                      toast.success("Stopping research", { description: "The agent stops after its current step." });
                    } else {
                      toast.success("Research stopped");
                    }
                  })
                }
              >
                {busy === "stop" && <Loader2 className="animate-spin" />}
                Stop research
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <form
          className="flex min-w-64 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = instruction.trim();
            if (!text) return;
            run("redirect", async () => {
              await post(`${base}/redirect`, { instruction: text });
              setInstruction("");
              toast.success("Instruction sent", {
                description: paused ? "The agent applies it when you resume." : "The agent applies it at its next step.",
              });
            });
          }}
        >
          <Input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={terminal ? "Research has ended" : "Redirect the agent, e.g. “Focus on environmental impact”"}
            maxLength={INSTRUCTION_MAX}
            disabled={terminal}
            aria-label="Instruction for the agent"
          />
          <Button type="submit" variant="secondary" disabled={terminal || !instruction.trim() || busy !== null}>
            {busy === "redirect" ? <Loader2 className="animate-spin" /> : <Send />}
            <span className="sr-only sm:not-sr-only">Send</span>
          </Button>
        </form>
      </div>

      {redirects.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-3.5 transition-transform group-data-panel-open:rotate-180" />
            {redirects.length} {redirects.length === 1 ? "instruction" : "instructions"} sent
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 flex flex-col gap-1.5">
              {redirects.toReversed().map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-sm">
                  <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-orange-400" />
                  <span className="min-w-0 flex-1 break-words">{r.instruction}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground" suppressHydrationWarning>
                    {r.appliedAt ? "applied" : terminal ? "not applied" : "pending"} · {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
