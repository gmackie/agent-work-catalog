/** Candidate verticals, not listings, accepted contracts or claims of market demand. */
export interface DomainOpportunity {
  readonly id:string;
  readonly domain:string;
  readonly buyer:string;
  readonly purchasableOutcome:string;
  readonly sourceAdapters:readonly string[];
  readonly executorPipeline:readonly string[];
  readonly inputs:readonly string[];
  readonly deliverables:readonly string[];
  readonly acceptanceTests:readonly string[];
  readonly pricingHypothesis:string;
  readonly firstDemo:string;
  readonly readiness:"design-only";
  readonly operationalRisk:"low"|"human-gated"|"regulated";
  readonly buildability:1|2|3|4|5;
  readonly differentiation:string;
}
export const domainOpportunities:readonly DomainOpportunity[]=[
  {
    id:"software.pr-quality",domain:"Software engineering",buyer:"Engineering managers and open-source maintainers",
    purchasableOutcome:"Reproduce one issue, submit a bounded patch and a reviewed test-evidence bundle",
    sourceAdapters:["GitHub App issues/PRs","Jira webhook"],executorPipeline:["isolated coding agent","CI test runner","reviewer"],
    inputs:["test repository/issue","approved branch and diff scope"],
    deliverables:["patch/PR","test output","impact notes","signed execution log"],
    acceptanceTests:["CI passes","diff confined to scope","independent review of changes"],
    pricingHypothesis:"$15-$100 per small completed fix; quote larger work",firstDemo:"Read-only code review plus test-improvement PR",
    readiness:"design-only",operationalRisk:"human-gated",buildability:5,
    differentiation:"Evidence-backed outcome rather than unlimited coding tokens",
  },
  {
    id:"cloud.iac-security",domain:"Cloud infrastructure and security",buyer:"Platform teams and MSPs",
    purchasableOutcome:"Identify high-confidence IaC drift or policy violations with reproducible controls",
    sourceAdapters:["GitHub","Terraform plan","Cloudflare API read-only"],
    executorPipeline:["IaC parser","policy-as-code engine","report assembler"],
    inputs:["redacted Terraform plan/CDK diff","tenant policy rules"],
    deliverables:["policy violations JSON","fix patch proposal","replayable rule evidence"],
    acceptanceTests:["OPA/Conftest pass","policy version pinned","no unauthorized infrastructure writes"],
    pricingHypothesis:"$10-$75 per review, $199+/month for scheduled baselines",
    firstDemo:"Terraform-plan rule assessment in sandbox",
    readiness:"design-only",operationalRisk:"human-gated",buildability:5,
    differentiation:"Deterministic policy checks and exact infrastructure change provenance",
  },
  {
    id:"industrial.protocol-evidence",domain:"Industrial PLC and fieldbus evidence",buyer:"Automation integrators and OT incident teams",
    purchasableOutcome:"Explain observable EtherNet/IP, OPC UA or Profinet communication anomalies",
    sourceAdapters:["R2 packet gateway","isolated field sensor exports"],
    executorPipeline:["protocol dissector","transaction correlator","specialist reviewer"],
    inputs:["public/sanitized PCAP","network role map","supported protocol declaration"],
    deliverables:["packet-linked protocol report","coverage table","limitations"],
    acceptanceTests:["TShark differential checks","protocol-specific transaction tests","no unsupported causal claims"],
    pricingHypothesis:"$25-$150 per capture; premium expert reviewed cases",
    firstDemo:"EtherNet/IP CIP error response evidence on sanitized capture",
    readiness:"design-only",operationalRisk:"human-gated",buildability:3,
    differentiation:"Deep industrial protocol parsing, context and portable evidence",
  },
  {
    id:"mobility.can-j1939",domain:"Automotive and off-highway diagnostics",buyer:"Fleet operators, repair shops and equipment OEMs",
    purchasableOutcome:"Decode bounded J1939/CAN logs into priority DTC/SPN/FMI hypotheses",
    sourceAdapters:["CAN log upload","approved Fleet API export"],
    executorPipeline:["DBC/PGN decoder","fault correlation","service bulletin context"],
    inputs:["deidentified CAN/J1939 capture","machine family","licensed DBC context"],
    deliverables:["diagnostic signals JSON","DTC references","repair verification checklist"],
    acceptanceTests:["DBC and PGN test vectors","frame provenance","no automatic vehicle actuation"],
    pricingHypothesis:"$15-$75 per log; enterprise fleet subscriptions",
    firstDemo:"J1939 DM1 SPN/FMI reader with synthetic bus log",
    readiness:"design-only",operationalRisk:"human-gated",buildability:3,
    differentiation:"Equipment-specific decoding with testable protocol claims",
  },
  {
    id:"building.bacnet",domain:"Building automation and energy",buyer:"Building operators, commissioning consultants",
    purchasableOutcome:"Identify BACnet schedule/point consistency and trend anomalies",
    sourceAdapters:["BACnet trend export","BMS CSV","Haystack tags"],
    executorPipeline:["point semantic mapper","trend QA","rule evaluator"],
    inputs:["exported anonymized point trends","site operating schedule"],
    deliverables:["point coverage map","trend exceptions","commissioning questions"],
    acceptanceTests:["cross-point units/limits","timezones","human engineer review"],
    pricingHypothesis:"$25-$125 per building review, recurring monitoring later",
    firstDemo:"Offline BACnet trend consistency checker",
    readiness:"design-only",operationalRisk:"human-gated",buildability:4,
    differentiation:"Portable commissioning evidence instead of a black-box anomaly score",
  },
  {
    id:"water.process-quality",domain:"Water/wastewater operations",buyer:"Municipal utilities and engineering firms",
    purchasableOutcome:"Validate telemetry completeness and exception reports against operating thresholds",
    sourceAdapters:["Historian CSV","SCADA read-only export"],
    executorPipeline:["time-series QC","rules","operator report"],
    inputs:["anonymized historian series","sensor metadata","approved process bands"],
    deliverables:["coverage and sensor drift report","out-of-bound events","data-quality provenance"],
    acceptanceTests:["mass-balance sanity constraints","sensor units","licensed operator approval"],
    pricingHypothesis:"Quoted $100-$500 study; monthly compliance-adjacent reporting",
    firstDemo:"Historical pump-flow telemetry QA report",
    readiness:"design-only",operationalRisk:"regulated",buildability:3,
    differentiation:"Reproducible telemetry QA with clear operator sign-off",
  },
  {
    id:"factory.spc-inspection",domain:"Manufacturing process quality",buyer:"Plant quality and process engineers",
    purchasableOutcome:"Build reproducible SPC and defect-concentration analysis from inspection tables",
    sourceAdapters:["MES CSV","QMS export","quality SQL read-only"],
    executorPipeline:["SPC statistics","measurement system QA","report generator"],
    inputs:["anonymized dimensional measurements","lot/shift metadata","spec limits"],
    deliverables:["control-chart data","capability and uncertainty notes","candidate follow-ups"],
    acceptanceTests:["recomputed statistics","sampling plan scope","engineer acceptance"],
    pricingHypothesis:"$30-$150 per lot study; ongoing QC subscription",
    firstDemo:"X-bar/R and process capability analysis for synthetic lot",
    readiness:"design-only",operationalRisk:"human-gated",buildability:5,
    differentiation:"Auditable statistics and provenance rather than speculative root cause",
  },
  {
    id:"food.formulation",domain:"Food science and formulation",buyer:"Culinary R&D and ingredient suppliers",
    purchasableOutcome:"Propose measurable formulation experiments and score lab observations",
    sourceAdapters:["Recipe CSV","texture/lab measurement export"],
    executorPipeline:["mixture constraint solver","DOE planner","result analyzer"],
    inputs:["ingredient constraints","safety/allergen data","lab measurements"],
    deliverables:["DOE matrix","target rheology ranges","experiment interpretation"],
    acceptanceTests:["mixture mass fractions sum","allergen constraints","food scientist approval"],
    pricingHypothesis:"$25-$150 per experiment plan plus paid lab verification",
    firstDemo:"Emulsion stability design-of-experiments planner",
    readiness:"design-only",operationalRisk:"human-gated",buildability:4,
    differentiation:"Physical experiments and measured outcomes distinguish it from recipe chat",
  },
  {
    id:"kitchen.capacity-forecast",domain:"Food-service operations",buyer:"Multi-unit restaurant franchisees",
    purchasableOutcome:"Forecast station utilization and surge capacity with backtestable order data",
    sourceAdapters:["POS CSV","KDS export","staffing schedule"],
    executorPipeline:["queueing model","scenario simulator","backtester"],
    inputs:["anonymized transaction timestamps","station capacity","labor schedule"],
    deliverables:["throughput and wait-time forecasts","staffing alternatives","backtest errors"],
    acceptanceTests:["holdout error","capacity conservation","manager sign-off"],
    pricingHypothesis:"$49-$249/site/month plus implementation",
    firstDemo:"Lunch-rush station capacity simulator with synthetic orders",
    readiness:"design-only",operationalRisk:"human-gated",buildability:4,
    differentiation:"Operational constraints and measured throughput rather than generic forecasts",
  },
  {
    id:"education.outcome-assessment",domain:"K-12 curriculum and assessment",buyer:"Teachers, districts and homeschool programs",
    purchasableOutcome:"Align teacher-authored assessments to learning objectives and explain coverage gaps",
    sourceAdapters:["OneRoster read-only","LTI export","QTI/Common Cartridge"],
    executorPipeline:["standards/CASE mapper","rubric alignment checker","teacher review"],
    inputs:["curriculum objectives","sanitized assessment items","rubric metadata"],
    deliverables:["alignment matrix","coverage gaps","teacher revision suggestions"],
    acceptanceTests:["versioned standards matches","teacher rubric review","FERPA minimum-data policy"],
    pricingHypothesis:"$2-$20 per assessment audit; institutional subscriptions",
    firstDemo:"Common Core objective coverage report using synthetic items",
    readiness:"design-only",operationalRisk:"regulated",buildability:5,
    differentiation:"Objective-by-objective evidence and teacher control, not automated child profiling",
  },
  {
    id:"health.hl7-fhir-conformance",domain:"Healthcare interoperability",buyer:"Health IT vendors and hospital integration teams",
    purchasableOutcome:"Validate structure, mappings and referential integrity of synthetic HL7/FHIR exchanges",
    sourceAdapters:["FHIR fixture export","HL7 v2 synthetic feed"],
    executorPipeline:["FHIR schema validator","mapping checker","test harness"],
    inputs:["synthetic/deidentified HL7 messages","target profiles/IG versions"],
    deliverables:["validation errors","field mapping diffs","interop test evidence"],
    acceptanceTests:["official schema/profile tests","semantic code checks","PHI exclusion"],
    pricingHypothesis:"$35-$250 per interface test; qualified consulting later",
    firstDemo:"FHIR bundle field and reference validation on synthetic data",
    readiness:"design-only",operationalRisk:"regulated",buildability:4,
    differentiation:"Standards-driven conformance evidence and versioned test fixtures",
  },
  {
    id:"procurement.rfp-compliance",domain:"Technical procurement and RFPs",buyer:"SMB sellers, government bidders and buyers",
    purchasableOutcome:"Map a proposal to RFP clauses and produce an evidence/exception matrix",
    sourceAdapters:["RFP PDF upload","document export","Q&A repository"],
    executorPipeline:["requirements extractor","traceability matrix","human reviewer"],
    inputs:["procurement documents","proposal draft","approved evidence sources"],
    deliverables:["clause traceability matrix","missing evidence","questions for the owner"],
    acceptanceTests:["every requirement cited","version-bound clauses","legal/procurement review"],
    pricingHypothesis:"$25-$200 per document set; contracted bid support extra",
    firstDemo:"PDF clause-to-evidence coverage matrix on a public RFP",
    readiness:"design-only",operationalRisk:"human-gated",buildability:5,
    differentiation:"Citation-complete traceability, not unverified auto-compliance claims",
  },
];
export function listCandidateDomains(){
  return domainOpportunities.map(item=>({...item,sourceAdapters:[...item.sourceAdapters],
    executorPipeline:[...item.executorPipeline],inputs:[...item.inputs],
    deliverables:[...item.deliverables],acceptanceTests:[...item.acceptanceTests]}));
}
