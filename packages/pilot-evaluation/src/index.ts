import { Effect } from "effect";
import {
  analyzeTcpPcap, evaluateTcpReport,
  type TcpObservation, type TcpReport,
} from "@awc/tcp-pcap";

export const PILOT_SCHEMA = "awc.tcp.pilot-case/v1" as const;
export const PILOT_SCORE_SCHEMA = "awc.tcp.pilot-score/v1" as const;
export const PROGRAM_SCHEMA = "awc.tcp.pilot-program/v1" as const;
export type ObservationKind = TcpObservation["kind"];
export type EvidenceGrade = TcpObservation["confidence"];
export type Annotation = {
  readonly kind: ObservationKind;
  readonly frames: readonly number[];
  readonly confidence: EvidenceGrade;
};
export type GroundTruth = {
  /** An authored test fixture is NOT independent human ground truth. */
  readonly origin: "synthetic-fixture-author" | "independently-adjudicated";
  readonly coverage: "exhaustive" | "partial";
  readonly blindedToReport: boolean;
  readonly reviewerPseudonyms: readonly string[];
  readonly expected: readonly Annotation[];
};
export type CaptureProvenance = {
  readonly sha256: string;
  readonly bytes: number;
  readonly origin: "synthetic-fixture" | "consented-sanitized";
  readonly clearance: "public-synthetic" | "documented-public-clearance";
  readonly captureVantage: "client" | "server" | "span" | "unknown";
  readonly completeness: "full-handshake" | "midstream" | "unknown";
  /** Consent reference is a non-secret random ID, never a person's name. */
  readonly consentRef?: string;
};
export type ReviewerOutcome = {
  readonly reviewerPseudonym: string;
  readonly usefulness: 1 | 2 | 3 | 4 | 5;
  readonly manualMinutes: number;
  readonly assistedMinutes: number;
  readonly wouldPay: boolean;
  readonly willingnessToPayMinor?: string;
  readonly unwarrantedCausalClaims: number;
  readonly acceptedDeliverable: boolean;
};
export type CostLine = {
  readonly category: "worker" | "storage" | "payment" | "model" | "review" |
    "support" | "refund-reserve" | "other";
  readonly source: "invoice" | "metered" | "assumption";
  readonly minorUnits: string;
  readonly sourceRef?: string;
};
export type PilotCase = {
  readonly schemaVersion: typeof PILOT_SCHEMA;
  readonly caseId: string;
  readonly offeringId: "offering:tcp-pcap-evidence";
  readonly offeringVersion: "1";
  readonly capture: CaptureProvenance;
  readonly groundTruth: GroundTruth;
  readonly outcomes: readonly ReviewerOutcome[];
  readonly pricing: {
    /** A scenario is not a charged amount. */
    readonly kind: "scenario" | "actual";
    readonly priceMinor: string;
    readonly currency: "USD";
  };
  readonly costLines: readonly CostLine[];
};
export type NumericMetric = number | null;
export type PilotCaseScore = {
  readonly schemaVersion: typeof PILOT_SCORE_SCHEMA;
  readonly caseId: string;
  readonly source: CaptureProvenance["origin"];
  readonly annotationOrigin: GroundTruth["origin"];
  readonly completeLabels: boolean;
  readonly repeatable: boolean;
  readonly tp: number;
  readonly fp: number | null;
  readonly fn: number;
  /** With incomplete labels, precision and F1 are *not estimable*. */
  readonly precision: NumericMetric;
  readonly annotatedRecall: NumericMetric;
  readonly f1: NumericMetric;
  readonly observedOutputCount: number;
  readonly annotatedPositiveCount: number;
  readonly falseCausalClaims: number;
  readonly signedObservationExternallyAuthorized: false;
  readonly claimRisk: "review-required" | "no-reviewed-causal-overclaims";
  readonly averageUsefulness: NumericMetric;
  readonly averageMinutesSaved: NumericMetric;
  readonly wouldPayFraction: NumericMetric;
  readonly cogsMinor: string | null;
  readonly costEvidence: "none" | "partial" | "fully-metered-or-invoiced";
  readonly scenarioContributionMinor: string | null;
  readonly actualContributionMinor: string | null;
  readonly warnings: readonly string[];
};
export class PilotError extends Error {
  readonly _tag = "PilotError";
  constructor(readonly code: "invalid" | "integrity" | "unsupported",
    message: string) { super(message); this.name = "PilotError"; }
}
const idOk = (v: string) => /^[a-z0-9][a-z0-9_-]{2,79}$/.test(v);
const hashOk = (v: string) => /^[a-f0-9]{64}$/.test(v);
const decimalOk = (v: string) => /^(0|[1-9]\d{0,11})$/.test(v);
const expectedKinds = new Set<ObservationKind>([
  "syn_observed", "syn_ack_observed", "rst_observed",
  "zero_window_advertised", "duplicate_sequence_range",
  "overlapping_sequence_range", "sequence_gap_observed",
  "ack_beyond_observed", "capture_truncated", "malformed_tcp",
]);
const gradeKinds = new Set<EvidenceGrade>(["direct", "capture_limited", "heuristic"]);
const reviewerOk = (v: string) => /^[a-z0-9][a-z0-9_-]{7,79}$/.test(v);
const key = (value: Annotation) =>
  value.kind + ":" + [...value.frames].join(",");
const finiteNonnegative = (v: number) => Number.isFinite(v) && v >= 0;
const avg = (values: readonly number[]): NumericMetric =>
  values.length ? values.reduce((s, n) => s + n, 0) / values.length : null;
const round6 = (v: number): number => Math.round(v * 1_000_000) / 1_000_000;
const fraction = (num: number, den: number): number =>
  den === 0 ? 1 : round6(num / den);
function validate(sample: PilotCase): void {
  if (sample.schemaVersion !== PILOT_SCHEMA || !idOk(sample.caseId) ||
      sample.offeringId !== "offering:tcp-pcap-evidence" ||
      sample.offeringVersion !== "1" ||
      !hashOk(sample.capture.sha256) ||
      !Number.isInteger(sample.capture.bytes) ||
      sample.capture.bytes <= 0 || sample.capture.bytes > 48 * 1024 ||
      !decimalOk(sample.pricing.priceMinor) || sample.pricing.currency !== "USD" ||
      !["scenario", "actual"].includes(sample.pricing.kind) ||
      !["client", "server", "span", "unknown"].includes(sample.capture.captureVantage) ||
      !["full-handshake", "midstream", "unknown"].includes(sample.capture.completeness)) {
    throw new PilotError("invalid", "Unsupported pilot contract or capture metadata");
  }
  if (sample.capture.origin === "synthetic-fixture") {
    if (sample.capture.clearance !== "public-synthetic" ||
        sample.groundTruth.origin !== "synthetic-fixture-author" ||
        sample.outcomes.length > 0 || sample.capture.consentRef !== undefined) {
      throw new PilotError("invalid", "Synthetic calibration cannot pose as human feedback");
    }
  } else if (sample.capture.origin === "consented-sanitized") {
    if (sample.capture.clearance !== "documented-public-clearance" ||
        !sample.capture.consentRef ||
        !idOk(sample.capture.consentRef) ||
        sample.groundTruth.origin !== "independently-adjudicated" ||
        sample.groundTruth.reviewerPseudonyms.length < 2 ||
        !sample.groundTruth.blindedToReport) {
      throw new PilotError("invalid", "Human evidence requires documented clearance and blinded adjudication");
    }
  } else {
    throw new PilotError("invalid", "Unsupported capture origin");
  }
  const reviewers = sample.groundTruth.reviewerPseudonyms;
  if (reviewers.some(x => !reviewerOk(x)) ||
      new Set(reviewers).size !== reviewers.length ||
      reviewers.length > 16 || sample.groundTruth.expected.length > 300) {
    throw new PilotError("invalid", "Invalid reviewer identities or annotation count");
  }
  if (!["exhaustive", "partial"].includes(sample.groundTruth.coverage)) {
    throw new PilotError("invalid", "Unknown annotation completeness");
  }
  const keys = new Set<string>();
  for (const entry of sample.groundTruth.expected) {
    if (!expectedKinds.has(entry.kind) || !gradeKinds.has(entry.confidence) ||
        !entry.frames.length || entry.frames.length > 8 ||
        entry.frames.some(n => !Number.isInteger(n) || n < 1 || n > 500) ||
        keys.has(key(entry))) {
      throw new PilotError("invalid", "Invalid or duplicate frame annotation");
    }
    keys.add(key(entry));
  }
  if (sample.outcomes.length > 16 ||
      new Set(sample.outcomes.map(x => x.reviewerPseudonym)).size !== sample.outcomes.length ||
      sample.outcomes.some(x => !reviewerOk(x.reviewerPseudonym) ||
        (sample.capture.origin === "consented-sanitized" &&
         !reviewers.includes(x.reviewerPseudonym)) ||
        !Number.isInteger(x.usefulness) || x.usefulness < 1 || x.usefulness > 5 ||
        !finiteNonnegative(x.manualMinutes) || !finiteNonnegative(x.assistedMinutes) ||
        x.manualMinutes > 24 * 60 || x.assistedMinutes > 24 * 60 ||
        !Number.isInteger(x.unwarrantedCausalClaims) || x.unwarrantedCausalClaims < 0 ||
        x.unwarrantedCausalClaims > 300 ||
        (x.willingnessToPayMinor !== undefined && !decimalOk(x.willingnessToPayMinor)))) {
    throw new PilotError("invalid", "Invalid real-review outcome");
  }
  if (sample.costLines.length > 32 ||
      sample.costLines.some(x => !decimalOk(x.minorUnits) ||
        (x.source !== "assumption" && !x.sourceRef) ||
        (x.sourceRef !== undefined && !idOk(x.sourceRef)))) {
    throw new PilotError("invalid", "Unverifiable pilot cost inputs");
  }
}
export function scorePilotCase(sample: PilotCase, report: TcpReport): PilotCaseScore {
  validate(sample);
  if (sample.capture.sha256 !== report.captureSha256 ||
      report.schemaVersion !== "awc.tcp.packet-evidence/v1" ||
      report.analyzer !== "awc/tcp-pcap@0.1.0" ||
      report.coverage.totalFrames > 500 ||
      !Array.isArray(report.observations)) {
    throw new PilotError("integrity", "Report is not from committed capture and parser");
  }
  const expected = new Map<string, Annotation>(
    sample.groundTruth.expected.map(x => [key(x), x])
  );
  const predicted = new Map<string, number>();
  let tp = 0, fp = 0;
  for (const item of report.observations) {
    const k = key(item);
    if (!expectedKinds.has(item.kind) ||
        !gradeKinds.has(item.confidence) ||
        item.frames.some((n: number) => !Number.isInteger(n) || n < 1 ||
          n > report.coverage.totalFrames)) {
      throw new PilotError("integrity", "Report contains out-of-scope assertions");
    }
    const old = predicted.get(k) ?? 0;
    predicted.set(k, old + 1);
    if (expected.has(k) && old === 0 &&
        expected.get(k)!.confidence === item.confidence) tp++;
    else fp++;
  }
  const fn = expected.size - tp;
  const complete = sample.groundTruth.coverage === "exhaustive";
  const precision = complete ? fraction(tp, tp + fp) : null;
  const recall = fraction(tp, expected.size);
  const f1 = precision === null ? null :
    (precision + recall === 0 ? 0 : round6(2 * precision * recall / (precision + recall)));
  const causal = sample.outcomes.reduce((n, x) => n + x.unwarrantedCausalClaims, 0);
  const usefulness = avg(sample.outcomes.map(x => x.usefulness));
  const timeSaved = avg(sample.outcomes.map(x => x.manualMinutes - x.assistedMinutes));
  const willingness = avg(sample.outcomes.map(x => Number(x.wouldPay)));
  const cogs = sample.costLines.length ?
    sample.costLines.reduce((sum, line) => sum + BigInt(line.minorUnits), 0n) : null;
  const fullyMeasured = sample.costLines.length > 0 &&
    sample.costLines.every(x => x.source !== "assumption");
  const costEvidence = cogs === null ? "none" :
    fullyMeasured ? "fully-metered-or-invoiced" : "partial";
  const contribution = cogs === null ? null :
    (BigInt(sample.pricing.priceMinor) - cogs).toString();
  const warnings = [
    "An AWC/remote-broker recomputation is a consistency check, not independent professional assurance.",
    "A locally signed observation does not establish issuer status or external authorization.",
    ...(sample.capture.origin === "synthetic-fixture" ?
      ["Synthetic fixture results cannot count as real reviewer or customer evidence."] : []),
    ...(!complete ? ["Partial annotations do not establish precision or F1."] : []),
    ...(sample.capture.completeness !== "full-handshake" ?
      ["The capture may omit connection establishment or important packets."] : []),
    ...(causal > 0 ? ["A reviewer flagged unsupported causal assertions."] : []),
    ...(costEvidence !== "fully-metered-or-invoiced" ?
      ["Cost and contribution are scenarios, not audited merchant economics."] : []),
  ];
  return {
    schemaVersion: PILOT_SCORE_SCHEMA, caseId: sample.caseId,
    source: sample.capture.origin, annotationOrigin: sample.groundTruth.origin,
    completeLabels: complete, repeatable: true,
    tp, fp: complete ? fp : null, fn, precision, annotatedRecall: recall, f1,
    observedOutputCount: report.observations.length,
    annotatedPositiveCount: expected.size,
    falseCausalClaims: causal,
    signedObservationExternallyAuthorized: false,
    claimRisk: causal ? "review-required" : "no-reviewed-causal-overclaims",
    averageUsefulness: usefulness === null ? null : round6(usefulness),
    averageMinutesSaved: timeSaved === null ? null : round6(timeSaved),
    wouldPayFraction: willingness === null ? null : round6(willingness),
    cogsMinor: cogs?.toString() ?? null,
    costEvidence,
    scenarioContributionMinor: contribution,
    actualContributionMinor: fullyMeasured && sample.pricing.kind === "actual" ?
      contribution : null,
    warnings,
  };
}
export const evaluateCase = (raw: Uint8Array, sample: PilotCase) =>
  Effect.tryPromise({
    try: async (): Promise<PilotCaseScore> => {
      validate(sample);
      const report = await analyzeTcpPcap(raw);
      if (report.captureSha256 !== sample.capture.sha256 ||
          raw.length !== sample.capture.bytes) {
        throw new PilotError("integrity", "Capture size/digest changed from recorded sample");
      }
      const checked = await evaluateTcpReport(raw, report);
      if (!checked.passed) throw new PilotError("integrity", "Report cannot be deterministically reproduced");
      return scorePilotCase(sample, checked.report);
    },
    catch: cause => cause instanceof PilotError ? cause :
      new PilotError("invalid", "TCP pilot sample could not be evaluated"),
  });
export type ProgramSummary = {
  readonly schemaVersion: typeof PROGRAM_SCHEMA;
  readonly cases: number;
  readonly calibrationCases: number;
  readonly practitionerCases: number;
  readonly distinctPractitioners: number;
  readonly adjudicatedCases: number;
  readonly precision: NumericMetric;
  readonly annotatedRecall: NumericMetric;
  readonly f1: NumericMetric;
  readonly meanUsefulness: NumericMetric;
  readonly meanMinutesSaved: NumericMetric;
  readonly willingnessToPayFraction: NumericMetric;
  readonly actualContributionMinor: string | null;
  readonly qualityGates: readonly {
    id: string; pass: boolean; detail: string;
  }[];
  readonly decision: "synthetic-calibration-only" | "collect-more-evidence" |
    "pilot-review-candidate";
  readonly note: string;
};
export function summarizePilotProgram(
  entries: readonly {case: PilotCase; score: PilotCaseScore}[]
): ProgramSummary {
  const allIds = entries.map(x => x.case.caseId);
  if (new Set(allIds).size !== allIds.length) throw new PilotError("invalid", "Duplicate case IDs");
  for (const entry of entries) {
    validate(entry.case);
    if (entry.score.caseId !== entry.case.caseId ||
        entry.score.source !== entry.case.capture.origin ||
        entry.score.schemaVersion !== PILOT_SCORE_SCHEMA) {
      throw new PilotError("integrity", "Case score is not bound to its source");
    }
  }
  const human = entries.filter(x => x.case.capture.origin === "consented-sanitized");
  const participants = new Set(human.flatMap(x =>
    x.case.groundTruth.reviewerPseudonyms));
  const humanScores = human.map(x => x.score);
  const exhaustive = humanScores.filter(x => x.completeLabels && x.fp !== null);
  const tp = exhaustive.reduce((n, x) => n + x.tp, 0);
  const fp = exhaustive.reduce((n, x) => n + x.fp!, 0);
  const fn = exhaustive.reduce((n, x) => n + x.fn, 0);
  const precision = exhaustive.length ? fraction(tp, tp + fp) : null;
  const recall = exhaustive.length ? fraction(tp, tp + fn) : null;
  const f1 = precision === null || recall === null ? null :
    (precision + recall === 0 ? 0 : round6(2 * precision * recall / (precision + recall)));
  const allFeedback = human.flatMap(x => x.case.outcomes);
  const usefulness = avg(allFeedback.map(x => x.usefulness));
  const saved = avg(allFeedback.map(x => x.manualMinutes - x.assistedMinutes));
  const willing = avg(allFeedback.map(x => Number(x.wouldPay)));
  const hasActualCosts = human.length > 0 && human.every(x =>
    x.score.actualContributionMinor !== null);
  const actualContribution = hasActualCosts ?
    human.reduce((n, x) => n + BigInt(x.score.actualContributionMinor!), 0n).toString() : null;
  const gates = [
    {id:"distinct-practitioners",pass:participants.size >= 3,
      detail:"At least three independent consenting practitioners."},
    {id:"adjudicated-real-captures",pass:human.length >= 12 && exhaustive.length >= 12,
      detail:"At least twelve sanitized, independently adjudicated and fully annotated captures."},
    {id:"precision",pass:precision !== null && precision >= 0.95,
      detail:"Review-set precision at least 95%; not a population guarantee."},
    {id:"recall",pass:recall !== null && recall >= 0.9,
      detail:"Review-set positive recall at least 90%; not a population guarantee."},
    {id:"no-causal-overclaims",pass:human.length > 0 &&
      humanScores.every(x => x.falseCausalClaims === 0),
      detail:"No reviewer-identified unsupported causal claims."},
    {id:"usefulness",pass:usefulness !== null && usefulness >= 4,
      detail:"Average usefulness at least four out of five among actual reviewers."},
    {id:"time-saved",pass:saved !== null && saved >= 5,
      detail:"Average time saved of at least five minutes with a recorded manual baseline."},
    {id:"measured-costs",pass:hasActualCosts,
      detail:"All scored real cases have itemized metered/invoiced costs and actual consideration."},
  ];
  const decision: ProgramSummary["decision"] = human.length === 0 ?
    "synthetic-calibration-only" :
    gates.every(x => x.pass) ? "pilot-review-candidate" : "collect-more-evidence";
  return {
    schemaVersion: PROGRAM_SCHEMA,cases:entries.length,
    calibrationCases:entries.length-human.length,
    practitionerCases:human.length,distinctPractitioners:participants.size,
    adjudicatedCases:exhaustive.length,
    precision,annotatedRecall:recall,f1,
    meanUsefulness:usefulness === null ? null : round6(usefulness),
    meanMinutesSaved:saved === null ? null : round6(saved),
    willingnessToPayFraction:willing === null ? null : round6(willing),
    actualContributionMinor:actualContribution,
    qualityGates:gates,decision,
    note:"Pilot-review-candidate is not authorization to enable production payments, nonpublic data, or certified Attest issuers.",
  };
}
