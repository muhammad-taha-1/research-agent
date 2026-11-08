"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postJson } from "@/lib/http";

/** Queues a report job. `pending` lasts until the refreshed page shows WRITING. */
export function useGenerateReport(projectId: string) {
  const router = useRouter();
  const [posting, setPosting] = useState(false);
  const [refreshing, startTransition] = useTransition();

  async function generate() {
    setPosting(true);
    try {
      await postJson(`/api/research/${projectId}/report`);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start the report");
    } finally {
      setPosting(false);
    }
  }

  return { generate, pending: posting || refreshing };
}
