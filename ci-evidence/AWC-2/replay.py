"""Reproduce all run-bound witnesses and both verdicts with the pinned CI harness."""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(path):
    return json.loads(path.read_bytes())


def sha(data):
    return hashlib.sha256(data).hexdigest()


def command(harness, *args, expected=0):
    result = subprocess.run([sys.executable, str(harness / "ci_perf.py"), *map(str, args)])
    if result.returncode != expected:
        raise SystemExit(f"Unexpected comparator exit {result.returncode}, expected {expected}")


def replay(harness, artifacts):
    claim = load(HERE / "claim.json")
    witnesses = []
    with tempfile.TemporaryDirectory() as temp:
        temp = Path(temp)
        for side in ("baseline", "candidate"):
            collection = HERE / f"{side}.json"
            for pair in claim["pairs"]:
                pin = pair[side]
                ident = pin["id"]
                receipt = load(HERE / "receipts" / f"{ident}.json")
                task_sha = receipt["artifact"]["tasksSha256"]
                source_tasks = (HERE / "tasks" / f"{task_sha}.json").read_bytes()
                if sha(source_tasks) != task_sha:
                    raise ValueError(f"Invalid normalized task input for {ident}")
                if artifacts:
                    archive = artifacts / f"{ident}.zip"
                    if sha(archive.read_bytes()) != receipt["artifact"]["sha256"]:
                        raise ValueError(f"GitHub artifact checksum mismatch for {ident}")
                    with zipfile.ZipFile(archive) as verified:
                        if verified.read("tasks.json") != source_tasks:
                            raise ValueError(f"GitHub task rows differ for {ident}")
                        meta = json.loads(verified.read("metadata.json"))
                        if (meta["run"], meta["attempt"], meta["sha"], meta["tree"]) != (
                            str(ident), "1", pin["sha"], receipt["tree"]
                        ):
                            raise ValueError(f"Artifact metadata differs for {ident}")
                envelope = {
                    "schemaVersion": 1, "kind": "ci-work-results", "origin": claim["origin"],
                    "repo": claim["repo"], "runId": ident, "sha": pin["sha"],
                    "checks": [{"name": receipt["jobName"], "jobId": receipt["jobId"],
                                "format": "tasks", "tasks": json.loads(source_tasks)}],
                }
                raw = (json.dumps(envelope, sort_keys=True, separators=(",", ":")) + "\n").encode()
                if sha(raw) != receipt["sourceSha256"]:
                    raise ValueError(f"Completed-work source checksum mismatch for {ident}")
                source = temp / "source.json"
                source.write_bytes(raw)
                witness = HERE / "witnesses" / f"{ident}.json"
                command(harness, "witness", "--collection", collection, "--input", source, "--verify", witness)
                witnesses.append(witness)
        for prefix in ("", "original-"):
            saved = load(HERE / f"{prefix}verdict.json")
            expected = {"improved": 0, "regression": 1, "inconclusive": 2}[saved["verdict"]]
            result = temp / "verdict.json"
            command(harness, "compare", "--claim", HERE / f"{prefix}claim.json",
                    "--baseline", HERE / f"{prefix}baseline.json", "--candidate", HERE / "candidate.json",
                    "--witness", *witnesses, "-o", result, expected=expected)
            if saved != load(result):
                raise ValueError(f"Saved {prefix}verdict differs")
            print(f"{prefix or 'corrected-'}verdict: {saved['verdict']}, {saved['eligiblePairs']} eligible pairs, exit {expected}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--harness-dir", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, help="Optional original GitHub ZIPs named RUN_ID.zip")
    args = parser.parse_args()
    replay(args.harness_dir.resolve(), args.artifact_dir)
