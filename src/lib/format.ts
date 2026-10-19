const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 12400 → "12.4K" */
export function formatTokens(n: number): string {
  return compact.format(n);
}

/** Sub-cent costs keep a significant digit instead of rounding to $0.00. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toPrecision(1)}`;
  return `$${usd.toFixed(2)}`;
}

/** 950 → "950ms", 4200 → "4.2s", 125000 → "2m 05s", 3720000 → "1h 02m" */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const totalSeconds = Math.floor(s);
  const m = Math.floor(totalSeconds / 60);
  if (m < 60) return `${m}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "https://www.example.com/a/b" → "example.com" */
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
