import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { analyzeClassicPcap, CaptureError } from "../src/index.ts";

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: tsx analyze_corpus.ts <generated-corpus-directory>");
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf-8")) as {
    cases: Array<{ name: string; file: string }>
  };
  const output = resolve(root, "reports");
  await mkdir(output, { recursive: true });
  for (const entry of manifest.cases) {
    if (!/^[a-z0-9_]+$/.test(entry.name) || entry.file !== entry.name + ".pcap") {
      throw new Error("Invalid corpus entry name");
    }
    const bytes = new Uint8Array(await readFile(resolve(root, entry.file)));
    let result: unknown;
    try {
      result = { status: "ok", report: await analyzeClassicPcap(bytes) };
    } catch (error) {
      if (!(error instanceof CaptureError)) throw error;
      result = { status: "rejected", error: { code: error.code, message: error.message } };
    }
    await writeFile(resolve(output, entry.name + ".json"), JSON.stringify(result, null, 2) + "\n");
  }
  console.log("Wrote " + manifest.cases.length + " TypeScript parser reports.");
}
await main();
