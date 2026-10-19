import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getSession } from "@/lib/auth";
import { Brand } from "./Sidebar";
import { UserMenu } from "./UserMenu";

export function Header() {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
      {/* The sidebar holds the brand and nav on desktop; on mobile the header does */}
      <div className="md:hidden">
        <Brand />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Link href="/research/new" className={buttonVariants({ size: "sm", className: "md:hidden" })}>
          <Plus />
          New
        </Link>
        <Suspense fallback={<div className="size-6 rounded-full bg-muted" />}>
          <HeaderUser />
        </Suspense>
      </div>
    </header>
  );
}

async function HeaderUser() {
  const session = await getSession();
  if (!session?.user) return null;
  const { name, email, image } = session.user;
  return <UserMenu name={name} email={email} image={image} />;
}
