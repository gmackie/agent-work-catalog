#!/usr/bin/env python3
"""Fail-closed Scapy/TShark/AWC differential conformance gate.

Compare Wireshark-dissected MBTCP fields to independently authored Scapy fixture
intents and AWC's own transaction/report assertions. Do not compare unsupported
behaviors as if our non-reassembling parser had Wireshark's TCP capabilities.
"""
from __future__ import annotations

import argparse
from collections import Counter
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Any

FIELDS = (
    "frame.number", "frame.time_epoch", "ip.src", "ip.dst",
    "tcp.srcport", "tcp.dstport", "mbtcp.trans_id", "mbtcp.unit_id",
    "modbus.func_code", "modbus.exception_code"
)


def numeric(text: str) -> int:
    value = text.strip()
    if not value:
        raise ValueError("Missing numeric dissection field")
    if value.lower().startswith("0x"):
        return int(value, 16)
    if not re.fullmatch(r"\d+", value):
        raise ValueError("Non-numeric TShark field: " + repr(value))
    return int(value, 10)


def run_tshark(path: Path) -> list[dict[str, Any]]:
    args = ["tshark", "-n", "-r", str(path), "-Y", "mbtcp",
            "-T", "fields", "-E", "separator=/t", "-E", "occurrence=a",
            "-E", "aggregator=,", "-E", "quote=n"]
    for field in FIELDS:
        args.extend(("-e", field))
    completed = subprocess.run(args, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise AssertionError("TShark failed for " + path.name + ": " +
                             completed.stderr[-1200:])
    messages = []
    for line in completed.stdout.splitlines():
        cells = line.rstrip("\r").split("\t")
        if len(cells) != len(FIELDS):
            raise AssertionError("TShark returned unexpected field count: " + repr(line))
        frame, timestamp, src, dst, sport, dport, tid, unit, function, exception = cells
        tids = tid.split(",") if tid else []
        units = unit.split(",") if unit else []
        funcs = function.split(",") if function else []
        exceptions = exception.split(",") if exception else []
        if not tids:
            # TShark can show an invalid MBTCP header without a valid transaction ID.
            continue
        if len(tids) != len(units) or len(tids) != len(funcs):
            raise AssertionError("Ambiguous TShark Modbus field grouping: " + repr(line))
        if len(tids) > 1 and exceptions and len(exceptions) != len(tids):
            raise AssertionError("Ambiguous repeated exception fields: " + repr(line))
        for index, tid_value in enumerate(tids):
            exc = (numeric(exceptions[index]) if len(exceptions) == len(tids) else
                   numeric(exceptions[0]) if len(exceptions) == 1 and len(tids) == 1 else None)
            messages.append({
                "frame": numeric(frame), "time": Decimal(timestamp), "src": src,
                "dst": dst, "sport": numeric(sport), "dport": numeric(dport),
                "tid": numeric(tid_value), "unit": numeric(units[index]),
                "function": numeric(funcs[index]) & 0x7f, "exception": exc,
            })
    return messages


def rows_without_time(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: value for key, value in row.items() if key != "time"}
            for row in messages]


def check_strict(case: dict[str, Any], report: dict[str, Any], tshark: list[dict[str, Any]]) -> None:
    expected = case["messages"]
    actual = rows_without_time(tshark)
    if actual != expected:
        raise AssertionError("TShark decoded MBTCP fields disagree with the fixture intention:\n"
                             + "expected=" + json.dumps(expected) + "\n"
                             + "tshark=" + json.dumps(actual))

    transactions = report["transactions"]
    completed = sorted(
        [{"requestFrame": tx["requestFrame"], "responseFrame": tx["responseFrame"],
          "tid": tx["transactionId"], "function": tx["functionCode"],
          "exception": tx.get("exceptionCode")}
         for tx in transactions if "responseFrame" in tx],
        key=lambda v: (v["requestFrame"], v["responseFrame"]))
    expected_pairs = sorted(case["pairs"],
                            key=lambda v: (v["requestFrame"], v["responseFrame"]))
    if completed != expected_pairs:
        raise AssertionError("AWC request/response pairs differ from independently "
                             "constructed packet sequence: " + json.dumps(completed))
    if sum("responseFrame" not in tx for tx in transactions) != case["findingCounts"]["unanswered_observed"]:
        raise AssertionError("Incorrect unpaired request count")

    # RTT is independently calculated from TShark frame timestamps, not Scapy's
    # test-intent timestamps and not AWC's own timer.
    times = {row["frame"]: row["time"] for row in tshark}
    for tx in transactions:
        if "responseFrame" not in tx:
            continue
        start, end = times[tx["requestFrame"]], times[tx["responseFrame"]]
        milliseconds = (end - start) * Decimal(1000)
        if milliseconds < 0:
            if "elapsedMs" in tx:
                raise AssertionError("Negative capture RTT was reported as a valid duration")
        elif abs(Decimal(str(tx.get("elapsedMs", -1))) - milliseconds) > Decimal("0.002"):
            raise AssertionError("AWC RTT is inconsistent with TShark frame timestamp")


def check_case(case: dict[str, Any], root: Path) -> str:
    path = root / case["file"]
    result = json.loads((root / "reports" / (case["name"] + ".json")).read_text())
    if case["mode"] == "reject":
        if result.get("status") != "rejected" or result.get("error", {}).get("code") != case["error"]:
            raise AssertionError("Expected bounded parser rejection, got " + str(result))
        return "reject expected"

    if result.get("status") != "ok":
        raise AssertionError("Unexpected AWC rejection: " + str(result))
    report = result["report"]
    if report["captureSha256"] != hashlib.sha256(path.read_bytes()).hexdigest():
        raise AssertionError("AWC capture commitment does not match original bytes")
    counts = Counter(item["kind"] for item in report["findings"])
    for kind, count in case["findingCounts"].items():
        if counts.get(kind, 0) != count:
            raise AssertionError(kind + " expected " + str(count) + " but got " +
                                 str(counts.get(kind, 0)))
    if case["mode"] == "strict":
        tshark = run_tshark(path)
        check_strict(case, report, tshark)
        unexpected = set(counts) - set(case["findingCounts"])
        if unexpected:
            raise AssertionError("Unexpected parser findings: " + str(unexpected))
        if report["coverage"]["parsedAdus"] != len(case["messages"]):
            raise AssertionError("AWC valid ADU count differs from Scapy/TShark")
        return str(len(tshark)) + " independently dissected messages"
    if case["mode"] != "parser-only":
        raise AssertionError("Unknown corpus case mode " + case["mode"])

    # Unsupported modes remain explicit regression assertions, not "passes"
    # against TShark's more complete reassembly and protocol support.
    name = case["name"]
    if name == "coalesced_adus" and report["coverage"]["parsedAdus"] != 2:
        raise AssertionError("Coalesced in-segment ADUs not counted")
    if name == "partial_tcp_adu" and report["coverage"]["incompleteSegments"] != 2:
        raise AssertionError("Fragmented TCP payload was incorrectly reconstructed")
    if name in ("ipv6_unsupported", "fragmented_ipv4_unsupported") and \
            report["coverage"]["parsedAdus"] != 0:
        raise AssertionError("Parser claimed unsupported IP stream data")
    if name == "malformed_protocol_id" and counts.get("malformed_mbap", 0) != 1:
        raise AssertionError("Malformed MBAP protocol field not detected")
    return "bounded unsupported-mode behavior asserted"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, type=Path)
    args = ap.parse_args()
    if not shutil.which("tshark"):
        raise SystemExit("TShark must be installed: independent protocol oracle is mandatory")
    root = args.dir.resolve()
    manifest = json.loads((root / "manifest.json").read_text())
    if manifest.get("schemaVersion") != "awc.pcap-conformance/v1":
        raise SystemExit("Unsupported corpus manifest")
    failures: list[str] = []
    strict = 0
    for case in manifest["cases"]:
        try:
            detail = check_case(case, root)
            if case["mode"] == "strict":
                strict += 1
            print("PASS " + case["name"] + " [" + case["mode"] + "]: " + detail)
        except Exception as exc:
            failures.append(case["name"] + ": " + str(exc))
            print("FAIL " + case["name"] + ": " + str(exc), file=sys.stderr)
    print("TShark version: " + subprocess.run(
        ["tshark", "--version"], capture_output=True, text=True).stdout.splitlines()[0])
    print("Cases: " + str(len(manifest["cases"])) +
          " (independently compared: " + str(strict) + ")")
    if failures:
        raise SystemExit(str(len(failures)) + " conformance failures\n" + "\n".join(failures))
    if strict < 10:
        raise SystemExit("Regression: too few independently compared scenarios")


if __name__ == "__main__":
    main()
