import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const from = fileURLToPath(new URL("../dist/index.html", import.meta.url));
const to = fileURLToPath(new URL("../../server/public/marketplace.html", import.meta.url));
await mkdir(fileURLToPath(new URL("../../server/public/", import.meta.url)), { recursive: true });
await copyFile(from, to);
console.log("MCP App bundled into Cloudflare Worker assets.");
