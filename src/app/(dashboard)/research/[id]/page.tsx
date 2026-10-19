import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { ResearchView } from "@/components/research/ResearchView";
import { requireUser } from "@/lib/auth";
import { getProjectDetail } from "@/lib/research/queries";

export default function ResearchPage({ params }: PageProps<"/research/[id]">) {
  return (
    <Suspense fallback={<ResearchViewSkeleton />}>
      <Research params={params} />
    </Suspense>
  );
}

async function Research({ params }: Pick<PageProps<"/research/[id]">, "params">) {
  const user = await requireUser();
  const { id } = await params;
  // Someone else's project 404s exactly like a missing one
  const project = await getProjectDetail(id, user.id);
  if (!project) notFound();
  return <ResearchView project={project} />;
}

function ResearchViewSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 lg:h-[calc(100svh-3.5rem)]" aria-busy="true">
      <Skeleton className="h-16 w-2/3" />
      <Skeleton className="h-20" />
      <Skeleton className="h-14" />
      <div className="grid min-h-80 flex-1 gap-4 lg:grid-cols-3">
        <Skeleton className="rounded-xl" />
        <Skeleton className="hidden rounded-xl lg:block" />
        <Skeleton className="hidden rounded-xl lg:block" />
      </div>
    </div>
  );
}
