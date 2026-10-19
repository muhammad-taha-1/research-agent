import { requireUser } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

// Placeholder until the Phase 4 dashboard.
export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <p className="font-mono text-sm text-muted-foreground">
        Signed in as {user.name ?? user.email}
      </p>
      <SignOutButton />
    </main>
  );
}
