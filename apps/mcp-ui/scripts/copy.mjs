import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const dir=fileURLToPath(new URL("../../server/public/",import.meta.url));
await mkdir(dir,{recursive:true});
await copyFile(fileURLToPath(new URL("../dist/index.html",import.meta.url)),dir+"marketplace.html");
await copyFile(fileURLToPath(new URL("../dist-contract/contract.html",import.meta.url)),dir+"contract.html");
await copyFile(fileURLToPath(new URL("../dist-operations/operations.html",import.meta.url)),dir+"operations.html");
await copyFile(fileURLToPath(new URL("../dist-tcp/tcp-report.html",import.meta.url)),dir+"tcp-report.html");
console.log("Bundled Marketplace, Contract, Operations and TCP Evidence MCP Apps into Worker assets.");
