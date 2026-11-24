# Agent Work Catalog CI measurement

**The full validation job finished 33.65% sooner by median paired change across three corrected GitHub-hosted pairs.** Every arm passed 247 verified work records with the same result digest. The ordinary pull-request check passed in 47 seconds. [Product PR #17](https://github.com/gmackie/agent-work-catalog/pull/17) · [Ordinary PR run](https://github.com/gmackie/agent-work-catalog/actions/runs/45332674229) · [Machine-readable verdict](verdict.json)

Hypothesis

> Reduce repeated TypeScript work in Agent Work Catalog validation while preserving every package check.

## Hosted timings

The first time in each cell is the baseline. Elapsed time runs from canonical GitHub workflow creation to the last executed job's completion. Queue time ends when the first recorded job starts.

| Pair | Baseline run | Candidate run | Full validation, seconds | Typecheck, seconds | Queue, seconds | Paired reduction |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | [45332361015](https://github.com/gmackie/agent-work-catalog/actions/runs/45332361015) | [45331383209](https://github.com/gmackie/agent-work-catalog/actions/runs/45331383209) | 112 → 75 | 59 → 15 | 3 → 4 | 33.04% |
| 2 | [45331720576](https://github.com/gmackie/agent-work-catalog/actions/runs/45331720576) | [45331539344](https://github.com/gmackie/agent-work-catalog/actions/runs/45331539344) | 113 → 47 | 58 → 8 | 3 → 3 | 58.41% |
| 3 | [45331969755](https://github.com/gmackie/agent-work-catalog/actions/runs/45331969755) | [45332203909](https://github.com/gmackie/agent-work-catalog/actions/runs/45332203909) | 104 → 69 | 54 → 14 | 4 → 3 | 33.65% |
| Median | | | **112 → 69** | **58 → 14** | **3 → 3** | **33.65%** |

The runnable job median was 109 → 66 seconds. The score is the median of the three within-pair percentage changes. GitHub's original and attempt endpoints sometimes give different creation timestamps. Each run receipt includes both, the job timestamps and the named step outcomes. [Receipts](receipts) · [Baseline collection](baseline.json) · [Candidate collection](candidate.json)

## Work and failure detection

All 53 package scripts use `tsc -p tsconfig.json`. There are seven config shapes and no TypeScript project references in these packages. pnpm resolves workspace exports to TypeScript source. The compiler's 53 file lists contain 16,768 entries for 1,556 distinct local source and dependency files. The repository itself contributes 407 entries for 141 distinct files. The contracts entry point participates in 39 programs.

The candidate asks pnpm for its workspace packages, then runs one TypeScript solution build over the individual configurations with `--force`. The compiler shares declaration parsing and resolution caches. It runs diagnostics against every configuration's own roots, options and ambient types. Force-builds write ignored per-project `.tsbuildinfo` files. Package-specific typecheck commands continue to work. Custom scripts, hooks, alternate TypeScript resolutions and forwarded arguments select the original recursive workflow. [Product patch](https://github.com/gmackie/agent-work-catalog/commit/34d96abb689c1930bbc2bdd960ad3246ad1b30b1)

The compiler emitted identical full file lists for all 53 projects in a local comparison, including package tests and Vite configs. Both implementations reported the same 53 injected assignment errors. Both rejected a Workers-only global in the Node project and accepted it in the Workers project. A custom script's exit code 17 propagated. [Per-project file-list digests](program-equivalence.json) · [Negative diagnostics and local checks](local-checks.json)

Every corrected run executed the actual install, four-page UI build, root typecheck, recursive Vitest suite, operations demo, standards demo and both Wrangler dry-run bundles. The sole job verified 53 successful compiler projects, 177 named passing tests across 62 files and 47 packages, six full scenario outputs, four byte-matching built/copied HTML pages and the JavaScript and source map for each Worker. Three further records bound the resolved lockfile, initial pnpm store file count and toolchain. The operations demo normalizes the random portion of synthetic event and reservation IDs while preserving their cross-references.

The collector verified six GitHub artifact ZIP digests and checked the normalized task bytes against an independent copy in each job log. The task output SHA-256 was `2fdc033274c7ab2069fd343a2670c5dac7997f953aac9de84b67ee859f27b627`. All six run-bound witnesses have normalized result digest `f2a7647b9a1e07dece56618e5aaccb89520bd6aa19733cecd340804841b3dcfc`. The ordinary PR used the uninstrumented workflow at product head `34d96abb689c1930bbc2bdd960ad3246ad1b30b1` and tested merge ref `00a0ac110266e9533979b920ae83e001dbd0b395`. It passed all 53 checks and 177 tests, built the UI, ran all six scenarios and dry-ran both bundles. Its typecheck took 9 seconds. The two packet-differential workflows' path conditions did not match the two changed files. [Normalized named tasks](tasks) · [Witnesses](witnesses) · [Ordinary PR step outcomes](ordinary-pr.json)

## Revisions and controls

| Condition | Ref | Revision |
| --- | --- | --- |
| Original product | main at trial setup | `4f30ec93253662129e26fb4175086799820d8677` |
| Candidate product | ci/measure-catalog-typecheck | `34d96abb689c1930bbc2bdd960ad3246ad1b30b1` |
| Corrected hosted baseline | ci/AWC-2-measure-baseline | `eacd464519d790ba1c2027f26bca43636bff1e5f` |
| Corrected hosted candidate | ci/AWC-2-measure-candidate | `1b11211469b0c3329c368e5118a64b172dab5aa6` |

The frozen input tree is `3dd5c2bed6cac20891414f07f7274f572c6ebd95`, obtained with `git rev-parse 4f30ec93253662129e26fb4175086799820d8677^{tree}`. It covers the original sources, configs, manifests, tests, fixtures and workflow. The binary diff between corrected arms has precisely the SHA-256 of the proposed two-file product patch. Both measurement arms add the same dispatch and reporting steps. GitHub ran each dispatch on a fresh `ubuntu-latest` X64 runner, image `ubuntu26` / `20261116.202.1`, with Node `v24.22.3`, pnpm `10.20.0` and TypeScript `6.0.3`. The pnpm store began empty. Both sides resolved dependencies with the original lockfile-free install. All six generated lockfiles share SHA-256 `e326ccf585da3e9b84d2ff91bb77c642768de77f6ab03c4753c9fcf75c56de03`. All action revisions are in the receipts. [Revision proof](revisions.json) · [Measured workflow](https://github.com/gmackie/agent-work-catalog/blob/1b11211469b0c3329c368e5118a64b172dab5aa6/.github/workflows/ci.yml) · [Reporter](https://github.com/gmackie/agent-work-catalog/blob/1b11211469b0c3329c368e5118a64b172dab5aa6/.ci-pilot/report.py)

## Failed pilot and ordering

Initial baseline run `45331041760` passed every ordinary step and verified 247 records. The upload step failed because the artifact path contained `..`. Its total elapsed time was 93 seconds and its typecheck took 46 seconds. The archive was never stored. The original three-slot comparison consequently had two eligible pairs and exit 2. [Failed run](https://github.com/gmackie/agent-work-catalog/actions/runs/45331041760) · [Original verdict](original-verdict.json)

The coordinator authorized one replacement baseline. Both measurement branches received the same uploader-path correction and log copy of the task records. Two corrected candidates had already been dispatched at the time of that authorization. The original pair assignments were retained and the replacement was scheduled before any corrected baseline was dispatched. Chronological corrected order was C1, C2, B2, B3, C3, B1. Pair 1 spans the other two pairs. The comparison includes all six corrected first attempts. Three pairs on one hosted image and dependency resolution give a small sample, and reporting adds work to every measured arm. The earlier 82-second historical run and the ordinary PR run are context only. [Frozen schedule amendment](https://github.com/gmackie/agent-work-catalog/blob/ff7d4ff71b0b507707b12755a843fdfa1e123fc8/ci-evidence/AWC-2/protocol.json) · [Dispatch record](dispatches.jsonl) · [Historical PR run](https://github.com/gmackie/agent-work-catalog/actions/runs/44865466431)

## Replay

Use the shared Python comparator from ForgeGraph commit `182b452b20cc306ee3596ad1976e2046ee6cff65`. The GitHub collector at revision `d528dacd531fed9bfd7615a0420a627f425272b1` used canonical creation and the complete first-attempt jobs page. The provider observation digest and witness digest for every arm appear in `claim.json`. Open a shell in this evidence directory and supply the path to the pinned comparator.

```sh
python3 replay.py --harness-dir /path/to/ForgeGraph/scripts/ci-perf
```

The script reproduces each witness from the preserved normalized tasks, checks the exact source-envelope bytes, and compares both verdicts. A successful replay prints the corrected verdict and the original inconclusive verdict. To verify the original archives too, download each GitHub artifact by the ID in its receipt, save it as `RUN_ID.zip`, then add `--artifact-dir /path/to/archives`. Raw job reports are on their original GitHub artifacts. Each public receipt preserves the ZIP's SHA-256 and expiration. [Shared comparator](https://git.forgegraf.com/gmackie/ForgeGraph/src/commit/182b452b20cc306ee3596ad1976e2046ee6cff65/scripts/ci-perf) · [Comparison manifest](claim.json)
