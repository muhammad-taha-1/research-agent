import { PrismaAdapter } from "@auth/prisma-adapter";
import { getServerSession, type NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import GitHubProvider from "next-auth/providers/github";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const authOptions: NextAuthOptions = {
  // @auth/prisma-adapter is typed against @auth/core and @prisma/client; with
  // next-auth v4 and Prisma 7's generated client both are structurally fine.
  adapter: PrismaAdapter(prisma as never) as Adapter,
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
    }),
  ],
  // JWT sessions so src/proxy.ts can verify the cookie without a DB call.
  // The adapter still persists User and Account rows.
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
};

export async function getSession() {
  // next-auth generates a CSRF token (crypto.randomBytes) inside getServerSession;
  // under cacheComponents that must be explicitly request-time, not prerendered.
  await connection();
  return getServerSession(authOptions);
}

/** For server components: the signed-in user, or a redirect to /login. */
export async function requireUser() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

/** For route handlers: the signed-in user's id, or null (respond 401). */
export async function getUserId() {
  const session = await getSession();
  return session?.user?.id ?? null;
}
