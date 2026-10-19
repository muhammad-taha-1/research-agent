/** A titled, internally scrolling column of the live research view. */
export function Panel({
  title,
  count,
  countLabel,
  children,
}: {
  title: string;
  count?: number;
  countLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card" aria-label={title}>
      <header className="flex h-10 shrink-0 items-center justify-between border-b px-4">
        <h2 className="font-mono text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
          {title}
        </h2>
        {count != null && (
          <span className="font-mono text-xs text-muted-foreground">
            {count} {countLabel}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

export function PanelEmpty({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">{icon}</span>
      <p className="max-w-60">{children}</p>
    </div>
  );
}
