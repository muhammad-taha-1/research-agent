"use client";

import { useEffect, useState } from "react";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { ACTIVE_STATUSES } from "@/lib/research/config";
import type { JobHealth } from "@/types/research";

const CHECK_EVERY_MS = 20_000;

/**
 * While a project says it's running, asks every 20s (and on every status change)
 * whether a job and a worker are really behind it. Null until the answer for the
 * current status arrives, and whenever the project isn't running.
 */
export function useJobHealth(projectId: string, status: ProjectStatus): JobHealth | null {
  const running = ACTIVE_STATUSES.includes(status);
  const [health, setHealth] = useState<JobHealth | null>(null);
  // Cleared during render rather than in the effect, so an answer about the old status never shows
  const [checkedStatus, setCheckedStatus] = useState(status);
  if (status !== checkedStatus) {
    setCheckedStatus(status);
    setHealth(null);
  }

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/research/${projectId}/job`, { cache: "no-store" });
        if (res.ok || res.status === 503) {
          const data = (await res.json()) as JobHealth;
          if (!cancelled) setHealth(data);
        }
      } catch {
        // Offline: the stream's connection indicator already says so
      }
    };
    void check();
    const id = setInterval(check, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [projectId, running, status]);

  return running ? health : null;
}
