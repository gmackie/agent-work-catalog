"""Turn this checkout's completed validation outputs into portable task records."""
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path.cwd()
MARK = Path(os.environ["PROOF_DIR"])
GRAPH = json.loads((Path(__file__).with_name("graphs.json")).read_text())
TASKS = {}

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

def record(key, raw):
    assert key not in TASKS and raw, key
    TASKS[key] = {"id": key, "status": "passed", "outputSha256": digest(raw)}

def relative(path):
    return str(Path(path).resolve().relative_to(ROOT))

def cli(*args):
    return subprocess.check_output(args, text=True).strip()

def typechecks():
    log = (MARK / "typecheck.log").read_text()
    log = re.sub(r"\x1b\[[0-9;]*m", "", log)
    standalone = re.findall(r"^(\S+) typecheck: Done\s*$", log, re.M)
    builds = re.findall(r"Building project '([^']+tsconfig\.json)'", log)
    assert bool(builds) != bool(standalone), "expected exactly one compiler path"
    checked = [relative(p) for p in builds] if builds else [p + "/tsconfig.json" for p in standalone]
    assert len(checked) == len(GRAPH) and set(checked) == set(GRAPH), (len(checked), set(GRAPH) - set(checked))
    compiler = json.loads(Path("node_modules/typescript/package.json").read_text())["version"]
    for config in checked:
        graph = GRAPH[config]
        if builds:
            path = Path(config).with_suffix(".tsbuildinfo")
            info = json.loads(path.read_text())
            assert info["version"] == compiler and not info.get("errors") and not info.get("checkPending")
            assert sorted(relative(path.parent / p) for p in info["root"]) == graph["roots"], config
        inputs = [config, "tsconfig.base.json", *graph["sourceFiles"]]
        record("tsc:" + config, encode({"root": graph["roots"], "verifiedInputs": [[p, digest(Path(p).read_bytes())] for p in inputs], "compiler": compiler}))

def tests():
    expected = {Path(c).parent for c in GRAPH if "test" in json.loads((Path(c).parent / "package.json").read_text())["scripts"]}
    found = set()
    for file in sorted(ROOT.glob("*/*/awc-ci-vitest.json")):
        package = file.parent.relative_to(ROOT)
        report = json.loads(file.read_bytes())
        assert report["success"] and not report["snapshot"].get("failure"), file
        assert report["numTotalTests"] == report["numPassedTests"] > 0, file
        count = 0
        for suite in report["testResults"]:
            name = relative(suite["name"])
            assert suite["status"] == "passed" and name.startswith(str(package) + "/")
            for case in suite["assertionResults"]:
                assert case["status"] == "passed" and not case["failureMessages"], case["fullName"]
                identity = [name, *case["ancestorTitles"], case["title"]]
                record("vitest:" + json.dumps(identity, separators=(",", ":")), encode([identity, case["status"]]))
                count += 1
        assert count == report["numPassedTests"]
        found.add(package)
        dest = MARK / "vitest" / package / "report.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, dest)
    assert found == expected, expected - found

def demos():
    decoder = json.JSONDecoder()
    for name in ["operations", "standards"]:
        text = (MARK / (name + ".log")).read_text()
        text = text[text.index("\n{"):].strip()
        scenarios = []
        while text:
            report, end = decoder.raw_decode(text)
            text = text[end:].strip()
            assert report["mode"] == "strictly-simulated"
            scenarios.append(report["scenario"])
            raw = encode(report)
            # Preserve joins between synthetic IDs. Only the random UUID part
            # of the two documented receipt/event fields varies per invocation.
            substitutions = {}
            pattern = rb"(event|reservation):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
            def stable(m):
                key = m.group()
                if key not in substitutions: substitutions[key] = m[1] + b":instance-" + str(len(substitutions) + 1).encode()
                return substitutions[key]
            record("demo:" + name + "/" + report["scenario"], re.sub(pattern, stable, raw))
        assert scenarios == ["vending", "cloud", "plant"], scenarios

def outputs():
    for src, dest in [("dist/index.html", "marketplace.html"), ("dist-contract/contract.html", "contract.html"),
                      ("dist-operations/operations.html", "operations.html"), ("dist-tcp/tcp-report.html", "tcp-report.html")]:
        built = (Path("apps/mcp-ui") / src).read_bytes()
        assert built == (Path("apps/server/public") / dest).read_bytes() and b"<html" in built.lower()
        record("ui:" + dest, built)
    for project in ["apps/server", "examples/remote-executor"]:
        directory = Path(project) / ".wrangler/dry-run"
        for filename in ["index.js", "index.js.map"]:
            data = (directory / filename).read_bytes()
            if filename.endswith(".map"): assert json.loads(data)["mappings"]
            record("bundle:" + project + "/" + filename, data)

def main():
    typechecks()
    tests()
    demos()
    outputs()
    versions = {"node": cli("node", "--version"), "pnpm": cli("pnpm", "--version"),
                "typescript": cli("node", "-p", "require('typescript/package.json').version"),
                "image": os.getenv("ImageOS"), "imageVersion": os.getenv("ImageVersion"), "arch": os.getenv("RUNNER_ARCH")}
    record("install:resolved-pnpm-lock.yaml", Path("pnpm-lock.yaml").read_bytes())
    record("environment:validation-toolchain", encode(versions))
    record("install:preexisting-store-file-count", encode(int((MARK / "store-files-before.txt").read_text())))
    tasks = [TASKS[key] for key in sorted(TASKS)]
    (MARK / "tasks.json").write_bytes(encode(tasks) + b"\n")
    meta = {"versions": versions, "checkout": cli("git", "rev-parse", "HEAD"), "tree": cli("git", "rev-parse", "HEAD^{tree}"),
            "run": os.getenv("GITHUB_RUN_ID"), "attempt": os.getenv("GITHUB_RUN_ATTEMPT"), "ref": os.getenv("GITHUB_REF"),
            "sha": os.getenv("GITHUB_SHA"), "event": os.getenv("GITHUB_EVENT_NAME"), "job": os.getenv("GITHUB_JOB"),
            "lockSha256": digest(Path("pnpm-lock.yaml").read_bytes())}
    (MARK / "metadata.json").write_bytes(encode(meta) + b"\n")
    print(f"{len(tasks)} completed validation tasks", json.dumps(versions, sort_keys=True))

if __name__ == "__main__":
    main()
