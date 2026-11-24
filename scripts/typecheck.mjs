import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/bin/tsc");
const extraArgs = process.argv.slice(2);
const recursive = ["-r", "--if-present", "typecheck", ...extraArgs];

// Use pnpm's workspace selection, including future packages and exclusions.
const pnpm = process.env.npm_execpath;
const viaPnpm = Boolean(process.env.npm_config_user_agent?.startsWith("pnpm/") && pnpm);
const command = viaPnpm ? process.execPath : "pnpm";
const prefix = viaPnpm ? [pnpm] : [];
const workspaces = JSON.parse(execFileSync(command, [...prefix, "-r", "list", "--depth", "-1", "--json"], {
  encoding: "utf8",
}));

const configs = [];
let batch = extraArgs.length === 0;
for (const { path } of workspaces) {
  if (resolve(path) === process.cwd()) continue;
  const { scripts } = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  if (!scripts?.typecheck) continue;
  if (scripts.typecheck !== "tsc -p tsconfig.json" || scripts.pretypecheck || scripts.posttypecheck ||
      require.resolve("typescript/bin/tsc", { paths: [path] }) !== compiler) {
    batch = false;
    break;
  }
  configs.push(join(path, "tsconfig.json"));
}

// Build mode shares compiler and resolution caches. Force each independent
// project through diagnostics even when a previous run left a .tsbuildinfo.
let result;
if (!batch) {
  result = spawnSync(command, [...prefix, ...recursive], { stdio: "inherit" });
} else if (configs.length) {
  result = spawnSync(process.execPath, [compiler, "--build", "--force", "--verbose", ...configs], { stdio: "inherit" });
}
if (result?.error) throw result.error;
if (result) process.exitCode = result.status ?? 1;
