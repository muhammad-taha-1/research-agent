import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInButton } from "./sign-in-button";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-mono text-lg">Research Agent</CardTitle>
          <CardDescription>Sign in to launch and monitor autonomous research runs.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* searchParams is request data, so it streams in behind the static card */}
          <Suspense fallback={<SignInButton callbackUrl="/" disabled />}>
            <SignInForm searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

async function SignInForm({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { callbackUrl, error } = await searchParams;
  // Only allow same-site relative paths, so ?callbackUrl can't bounce users off-site.
  const target =
    typeof callbackUrl === "string" && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/";

  return (
    <>
      {error && <p className="text-sm text-destructive">Sign-in failed. Please try again.</p>}
      <SignInButton callbackUrl={target} />
    </>
  );
}
