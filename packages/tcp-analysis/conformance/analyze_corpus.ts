import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { analyzeTcpCapture, TcpCaptureError } from "../src/index.ts";

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error("Usage: tsx analyze_corpus.ts <scapy-directory>");
  const root = resolve(name);
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as {
    cases: Array<{ name: string; file: string }>
  };
  await mkdir(resolve(root, "tcp-reports"), { recursive: true });
  for (const item of manifest.cases) {
    if (!/^[a-z0-9_]+$/.test(item.name) || item.file !== item.name + ".pcap") {
      throw new Error("Invalid synthetic corpus entry");
    }
    const bytes = new Uint8Array(await readFile(resolve(root, item.file)));
    let report: object;
    try {
      report = { status: "ok", report: await analyzeTcpCapture(bytes) };
    } catch (error) {
      if (!(error instanceof TcpCaptureError)) throw error;
      report = { status: "rejected", error: { code: error.code, message: error.message } };
    }
    await writeFile(resolve(root, "tcp-reports", item.name + ".json"),
      JSON.stringify(report, null, 2) + "\n");
  }
  console.log("Analyzed " + manifest.cases.length + " synthetic captures with TCP flow engine");
}
await main();
