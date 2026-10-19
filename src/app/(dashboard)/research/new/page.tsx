import { NewResearchForm } from "@/components/research/NewResearchForm";

export default function NewResearchPage() {
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
      <NewResearchForm />
    </div>
  );
}
