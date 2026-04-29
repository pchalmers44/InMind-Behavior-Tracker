import NextAuth, { type NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";

const isBuildTime =
  process.env.npm_lifecycle_event === "build" ||
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.NEXT_PHASE === "phase-export";

function requireEnv(name: "GITHUB_ID" | "GITHUB_SECRET" | "NEXTAUTH_SECRET"): string {
  const value = process.env[name];
  if (value) return value;
  if (isBuildTime) return "";
  throw new Error(`Missing required environment variable: ${name}`);
}

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: requireEnv("GITHUB_ID"),
      clientSecret: requireEnv("GITHUB_SECRET"),
    }),
  ],
  secret: requireEnv("NEXTAUTH_SECRET"),
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
