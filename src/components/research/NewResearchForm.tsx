"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, Plus, Rocket, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  DEPTH_OPTIONS,
  DEPTHS,
  FOCUS_AREA_MAX_LENGTH,
  FOCUS_AREAS_MAX,
  QUERY_MAX,
  QUERY_MIN,
} from "@/lib/research/config";
import type { ResearchDepth } from "@/generated/prisma/enums";

const EXAMPLES = [
  "What are the latest developments in solid-state batteries?",
  "Compare the top 5 project management tools for startups in 2026",
  "How is AI being used in drug discovery?",
];

export function NewResearchForm() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState<ResearchDepth>("STANDARD");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [focusDraft, setFocusDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = query.trim();
  const tooShort = trimmed.length < QUERY_MIN;

  function addFocusArea() {
    const area = focusDraft.trim();
    if (!area || focusAreas.length >= FOCUS_AREAS_MAX || focusAreas.includes(area)) return;
    setFocusAreas([...focusAreas, area]);
    setFocusDraft("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort) {
      setError(`Describe your question in at least ${QUERY_MIN} characters.`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, depth, focusAreas }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);

      // The project exists now, so a failed start isn't fatal: it can be started from its page
      const start = await fetch(`/api/research/${body.id}/start`, { method: "POST" });
      if (!start.ok) {
        const { error } = await start.json().catch(() => ({}));
        toast.error("Couldn't start the agent", { description: error ?? `Request failed (${start.status})` });
      }
      router.push(`/research/${body.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      toast.error("Couldn't create the research project", { description: message });
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <label htmlFor="query" className="text-sm font-medium">
          Research question
        </label>
        <Textarea
          id="query"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (error) setError(null);
          }}
          placeholder="What do you want to know? Be as specific as you like."
          maxLength={QUERY_MAX}
          rows={5}
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby="query-hint"
          className="min-h-32 resize-y text-base"
        />
        <div id="query-hint" className="flex justify-between gap-4 text-xs">
          <span className={cn("text-muted-foreground", error && "text-destructive")}>
            {error ?? `At least ${QUERY_MIN} characters.`}
          </span>
          <span className="font-mono text-muted-foreground tabular-nums">
            {query.length}/{QUERY_MAX}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setQuery(example)}
              className="rounded-full border px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
      </section>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">Depth</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {DEPTHS.map((d) => {
            const opt = DEPTH_OPTIONS[d];
            return (
              // Native radios: arrow-key navigation and form semantics for free
              <label
                key={d}
                className="flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors hover:border-foreground/20 hover:bg-accent/40 has-checked:border-sidebar-primary has-checked:bg-sidebar-primary/10 has-checked:ring-1 has-checked:ring-sidebar-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input
                  type="radio"
                  name="depth"
                  value={d}
                  checked={depth === d}
                  onChange={() => setDepth(d)}
                  className="sr-only"
                />
                <span className="flex items-center justify-between">
                  <span className="font-medium">{opt.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{opt.estimate}</span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">{opt.searches}</span>
                <span className="text-xs text-muted-foreground">{opt.description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <section className="flex flex-col gap-3">
        <label htmlFor="focus" className="text-sm font-medium">
          Focus areas <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <div className="flex gap-2">
          <Input
            id="focus"
            value={focusDraft}
            onChange={(e) => setFocusDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFocusArea();
              }
            }}
            placeholder="e.g. environmental impact, European market"
            maxLength={FOCUS_AREA_MAX_LENGTH}
            disabled={focusAreas.length >= FOCUS_AREAS_MAX}
          />
          <Button
            type="button"
            variant="outline"
            onClick={addFocusArea}
            disabled={!focusDraft.trim() || focusAreas.length >= FOCUS_AREAS_MAX}
          >
            <Plus />
            Add
          </Button>
        </div>
        {focusAreas.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {focusAreas.map((area) => (
              <li
                key={area}
                className="inline-flex items-center gap-1 rounded-full border bg-muted py-0.5 pr-1 pl-3 text-xs"
              >
                {area}
                <button
                  type="button"
                  onClick={() => setFocusAreas(focusAreas.filter((a) => a !== area))}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={`Remove ${area}`}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Up to {FOCUS_AREAS_MAX}. The agent prioritizes these while researching.
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-6">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4" />
          Estimated time: {DEPTH_OPTIONS[depth].estimate}
        </span>
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" /> : <Rocket />}
          {submitting ? "Creating…" : "Start research"}
        </Button>
      </div>
    </form>
  );
}
