import { Suspense } from "react";
import { NewResearchForm } from "@/components/research/NewResearchForm";

export default function NewResearchPage({ searchParams }: PageProps<"/research/new">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 md:p-6">
      <div>
        <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">New mission</p>
        <h1 className="text-2xl font-semibold tracking-tight">Start new research</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe what you want to learn. The agent plans, searches, reads, and takes notes; you
          can pause, stop, or redirect it at any point.
        </p>
      </div>
      {/* The query string is request data: the empty form is the static shell, the prefilled one streams in */}
      <Suspense fallback={<NewResearchForm />}>
        <PrefilledForm searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function PrefilledForm({ searchParams }: Pick<PageProps<"/research/new">, "searchParams">) {
  const { q } = await searchParams;
  return <NewResearchForm initialQuery={typeof q === "string" ? q : ""} />;
}
