import { Suspense } from "react";
import { requireUser } from "@/lib/auth";

// The authoritative auth check for every dashboard page; src/proxy.ts is only optimistic.
// Reading the session is request data, so under cacheComponents it sits inside Suspense.
export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
      <AuthGate>{children}</AuthGate>
    </Suspense>
  );
}

async function AuthGate({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
