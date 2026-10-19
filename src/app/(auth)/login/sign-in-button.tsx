"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignInButton({
  callbackUrl,
  disabled = false,
}: {
  callbackUrl: string;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);

  return (
    <Button
      size="lg"
      disabled={disabled || pending}
      onClick={() => {
        setPending(true);
        signIn("github", { callbackUrl });
      }}
    >
      {pending ? "Redirecting to GitHub…" : "Continue with GitHub"}
    </Button>
  );
}
