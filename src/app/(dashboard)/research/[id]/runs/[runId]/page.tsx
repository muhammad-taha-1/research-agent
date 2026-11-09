import { Suspense } from "react";
import { notFound } from "next/navigation";
import { RunDebugger } from "@/components/research/RunDebugger";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import { getRunDetail } from "@/lib/research/queries";

// The agent debugger for one run: every step with its reasoning, tool input and
// result, timing, tokens, and cost.
export default function RunPage({ params }: PageProps<"/research/[id]/runs/[runId]">) {
  return (
    <Suspense fallback={<RunSkeleton />}>
      <Run params={params} />
    </Suspense>
  );
}

async function Run({ params }: Pick<PageProps<"/research/[id]/runs/[runId]">, "params">) {
  const user = await requireUser();
  const { id, runId } = await params;
  // Someone else's run 404s exactly like a missing one
  const detail = await getRunDetail(id, runId, user.id);
  if (!detail) notFound();
  return <RunDebugger detail={detail} />;
}

function RunSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" aria-busy="true">
      <Skeleton className="h-14 w-2/3" />
      <Skeleton className="h-20" />
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="hidden h-96 rounded-xl lg:block" />
      </div>
    </div>
  );
}
