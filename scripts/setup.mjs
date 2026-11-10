#!/usr/bin/env node
// Checks that everything ResearchAgent needs is in place, and says what to do next.
//
//   npm run setup
//
// Checks Node, npm, Docker (installed and running), the Postgres and Redis
// containers, and .env.local. Creates .env.local from .env.example when it's missing,
// with a generated NEXTAUTH_SECRET. Changes nothing else; it only reports.

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const path = (p) => new URL(p, root);
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const [green, red, yellow, dim, bold] = [32, 31, 33, 2, 1].map(paint);

let failures = 0;
let warnings = 0;
const ok = (msg) => console.log(`  ${green("✓")} ${msg}`);
const fail = (msg, fix) => {
  failures++;
  console.log(`  ${red("✗")} ${msg}${fix ? `\n    ${dim(fix)}` : ""}`);
};
const warn = (msg, fix) => {
  warnings++;
  console.log(`  ${yellow("!")} ${msg}${fix ? `\n    ${dim(fix)}` : ""}`);
};

/** A command's trimmed output, or null if it fails or isn't installed. */
function run(cmd) {
  try {
    return execSync(cmd, { cwd: root, stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).toString().trim();
  } catch {
    return null;
  }
}

// ---- Tools ----
console.log(bold("\nTools"));

// Prisma 7 is the strictest dependency: ^20.19 || ^22.12 || >=24
const [major, minor] = process.versions.node.split(".").map(Number);
const nodeOk = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 24;
if (nodeOk) ok(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} is too old`, "Install Node 22.12+ (or 20.19+, or 24+): https://nodejs.org");

const npm = run("npm --version");
if (npm) ok(`npm ${npm}`);
else fail("npm not found", "It comes with Node: https://nodejs.org");

if (existsSync(path("node_modules"))) ok("Dependencies installed");
else fail("Dependencies not installed", "Run: npm install");

const docker = run("docker --version");
let dockerRunning = false;
if (!docker) {
  fail("Docker not found", "Install Docker Desktop: https://www.docker.com/products/docker-desktop");
} else {
  ok(docker.replace(/^Docker version /, "Docker "));
  dockerRunning = run("docker info --format {{.ServerVersion}}") !== null;
  if (!dockerRunning) fail("Docker isn't running", "Start Docker Desktop, then run this again");
  else if (!run("docker compose version")) fail("Docker Compose v2 not found", "Update Docker Desktop");
}

// ---- Services ----
console.log(bold("\nServices (docker-compose.yml)"));
if (!dockerRunning) {
  warn("Skipped: Docker isn't running");
} else {
  const running = (run("docker compose ps --status running --services") ?? "").split(/\r?\n/);
  for (const [service, what] of [
    ["db", "Postgres"],
    ["redis", "Redis"],
  ]) {
    if (running.includes(service)) ok(`${what} is running`);
    else fail(`${what} isn't running`, "Run: docker compose up -d");
  }
}

// ---- Environment ----
console.log(bold("\nEnvironment (.env.local)"));
const envPath = path(".env.local");
if (!existsSync(envPath)) {
  copyFileSync(path(".env.example"), envPath);
  const secret = randomBytes(32).toString("base64");
  const text = readFileSync(envPath, "utf8").replace(/^NEXTAUTH_SECRET=.*$/m, `NEXTAUTH_SECRET="${secret}"`);
  writeFileSync(envPath, text);
  ok("Created .env.local from .env.example, with a generated NEXTAUTH_SECRET");
}

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .map((line) => /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/.exec(line))
    .filter(Boolean)
    .map(([, key, value]) => [key, value]),
);
// Values still holding .env.example's placeholder text count as missing
const placeholder = (v) => !v || /^(your-|generate-with|tvly-\.\.\.$)/.test(v);
const REQUIRED = {
  DATABASE_URL: "Postgres connection string (the default matches docker-compose.yml)",
  REDIS_URL: "Redis URL (the default matches docker-compose.yml)",
  NEXTAUTH_URL: "The app's URL, e.g. http://localhost:3000",
  NEXTAUTH_SECRET: `Any long random string: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
  GITHUB_ID: "GitHub OAuth app client ID: https://github.com/settings/developers (callback: <NEXTAUTH_URL>/api/auth/callback/github)",
  GITHUB_SECRET: "GitHub OAuth app client secret",
  ANTHROPIC_API_KEY: "Claude API key: https://console.anthropic.com",
  TAVILY_API_KEY: "Web search API key (free tier): https://tavily.com",
};
for (const [key, help] of Object.entries(REQUIRED)) {
  if (placeholder(env[key])) fail(`${key} is not set`, help);
  else ok(key);
}

// ---- Summary ----
console.log("");
if (failures === 0) {
  console.log(green(bold("All set.")) + (warnings ? yellow(` (${warnings} warning${warnings === 1 ? "" : "s"})`) : ""));
  console.log(`
Next:
  npm run db:migrate   ${dim("# create the tables (first run only)")}
  npm run dev:all      ${dim("# the app on http://localhost:3000 and the worker")}
`);
} else {
  console.log(red(bold(`${failures} thing${failures === 1 ? "" : "s"} to fix`)) + " — see above, then run npm run setup again.\n");
  process.exitCode = 1;
}
