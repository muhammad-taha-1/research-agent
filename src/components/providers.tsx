"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TooltipProvider>{children}</TooltipProvider>
      {/* The app is dark-only, so no next-themes provider; pin the toaster to match */}
      <Toaster theme="dark" position="bottom-right" />
    </SessionProvider>
  );
}
