import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { requireUser } from "@/lib/auth";

// The authoritative auth check for every dashboard page; src/proxy.ts is only optimistic.
// The shell is static; reading the session is request data, so under cacheComponents
// the gated content sits inside Suspense.
export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
        <AuthGate>{children}</AuthGate>
      </Suspense>
    </AppShell>
  );
}

async function AuthGate({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
