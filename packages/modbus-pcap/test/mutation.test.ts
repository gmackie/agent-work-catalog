import { describe, expect, it } from "vitest";
import { analyzeClassicPcap, CaptureError } from "../src/index.ts";
import { makeTestPcap } from "../src/testing.ts";

const original = makeTestPcap([
  { direction: "request", transactionId: 12, functionCode: 3, timestampMicros: 1000 },
  { direction: "response", transactionId: 12, functionCode: 3, timestampMicros: 42000 },
  { direction: "request", transactionId: 13, functionCode: 4, timestampMicros: 85000 },
  { direction: "response", transactionId: 13, functionCode: 4, exceptionCode: 2, timestampMicros: 150000 },
]);

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}
function mutate(seed: number): Uint8Array {
  const next = seeded(seed);
  let bytes = Uint8Array.from(original);
  const mode = seed % 6;
  if (mode === 0) {
    bytes[next() % bytes.length]! ^= 1 << (next() % 8);
  } else if (mode === 1) {
    bytes = bytes.slice(0, next() % bytes.length);
  } else if (mode === 2) {
    const at = next() % bytes.length;
    bytes[at] = next() & 0xff;
    if (at + 1 < bytes.length) bytes[at + 1] = next() & 0xff;
  } else if (mode === 3) {
    const at = next() % 24;
    bytes[at] = next() & 0xff;
  } else if (mode === 4) {
    // A record-length or network-header mutation without trusting the original framing.
    const at = (16 + next() % Math.max(1, bytes.length - 16));
    bytes[at] = next() & 0xff;
  } else {
    bytes = Uint8Array.from([...bytes, ...Array.from({length: next() % 9}, () => next() & 0xff)]);
  }
  return bytes;
}

describe("bounded deterministic malformed-PCAP mutation sweep", () => {
  it("never throws untyped errors, leaks unbounded output, or produces invalid timing", async () => {
    for (let seed = 1; seed <= 1200; seed++) {
      const bytes = mutate(seed);
      try {
        const report = await analyzeClassicPcap(bytes);
        expect(report.coverage.totalFrames).toBeLessThanOrEqual(500);
        expect(report.coverage.parsedAdus).toBeLessThanOrEqual(250);
        expect(report.transactions.length).toBeLessThanOrEqual(250);
        expect(report.findings.length).toBeLessThanOrEqual(250);
        expect(JSON.stringify(report).length).toBeLessThan(120_000);
        for (const tx of report.transactions) {
          if (tx.elapsedMs !== undefined) {
            expect(Number.isFinite(tx.elapsedMs)).toBe(true);
            expect(tx.elapsedMs).toBeGreaterThanOrEqual(0);
          }
        }
      } catch (error) {
        if (!(error instanceof CaptureError)) {
          throw new Error("Unexpected unchecked parser error on deterministic mutation seed " +
                          seed + ": " + String(error));
        }
      }
    }
  }, 20_000);
});
