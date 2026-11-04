#!/usr/bin/env python3
"""Independent TCP flow-field differential oracle against TShark.

Strict Scapy scenarios only; unsupported modes are NOT claimed as parity.
"""
from __future__ import annotations
from collections import defaultdict
import argparse
import json
from pathlib import Path
import subprocess
import sys

FIELDS = ["frame.number", "ip.src", "ip.dst", "tcp.srcport", "tcp.dstport",
          "tcp.len", "tcp.flags.syn", "tcp.flags.ack", "tcp.flags.reset",
          "tcp.flags.fin", "tcp.window_size_value"]


def bit(value: str) -> int:
    if value in ("True", "true"):
        return 1
    if value in ("False", "false"):
        return 0
    return int(value, 0)


def tshark_tcp(path: Path) -> list[dict]:
    args = ["tshark", "-n", "-r", str(path), "-Y", "ip && tcp", "-T", "fields",
            "-E", "separator=/t", "-E", "occurrence=f", "-E", "quote=n"]
    for field in FIELDS:
        args += ["-e", field]
    output = subprocess.run(args, capture_output=True, text=True, check=False)
    if output.returncode:
        raise AssertionError("TShark TCP decode failed: " + output.stderr[-900:])
    records = []
    for line in output.stdout.splitlines():
        cells = line.split("\t")
        if len(cells) != len(FIELDS):
            raise AssertionError("Unexpected TShark TCP field row: " + repr(line))
        n, src, dst, sport, dport, size, syn, ack, rst, fin, window = cells
        records.append({
            "frame": int(n), "src": src, "dst": dst, "sport": int(sport), "dport": int(dport),
            "payload": int(size), "syn": bit(syn), "ack": bit(ack),
            "rst": bit(rst), "fin": bit(fin), "window": int(window)
        })
    return records


def verify(case: dict, root: Path) -> None:
    result = json.loads((root / "tcp-reports" / (case["name"] + ".json")).read_text())
    if case["mode"] == "reject":
        if result["status"] != "rejected":
            raise AssertionError("TCP parser accepted an explicitly rejected capture")
        return
    if result["status"] != "ok":
        raise AssertionError("TCP parser rejected a valid synthetic capture")
    report = result["report"]
    if case["mode"] != "strict":
        if case["name"] == "tcp_retransmission":
            if sum(f["repeatedPayloadSegments"] for f in report["flows"]) != 1:
                raise AssertionError("Duplicate TCP sequence range not recognized")
        if case["name"] == "ipv6_unsupported" and report["coverage"]["parsedTcpSegments"] != 0:
            raise AssertionError("IPv6 should remain unsupported")
        if case["name"] == "fragmented_ipv4_unsupported" and report["coverage"]["parsedTcpSegments"] != 0:
            raise AssertionError("IP fragments should remain unsupported")
        return

    packets = tshark_tcp(root / case["file"])
    if len(packets) != report["coverage"]["parsedTcpSegments"]:
        raise AssertionError("AWC TCP segment count mismatched TShark: " + case["name"])
    if report["coverage"]["totalFrames"] < len(packets):
        raise AssertionError("Frame count smaller than TShark packet count")
    by_flow: dict[str, list[dict]] = defaultdict(list)
    for packet in packets:
        from_ep = packet["src"] + ":" + str(packet["sport"])
        to_ep = packet["dst"] + ":" + str(packet["dport"])
        fid = "|".join(sorted((from_ep, to_ep)))
        by_flow[fid].append(packet)
    actual = {flow["id"]: flow for flow in report["flows"]}
    if set(actual) != set(by_flow):
        raise AssertionError("Canonical flow endpoints mismatch TShark")
    for fid, observed in by_flow.items():
        f = actual[fid]
        if f["observedSegments"] != len(observed):
            raise AssertionError("Wrong TCP segment count for " + fid)
        if f["observedPayloadBytes"] != sum(p["payload"] for p in observed):
            raise AssertionError("TCP payload byte counts differ from TShark: " + fid)
        if f["payloadSegments"] != sum(p["payload"] > 0 for p in observed):
            raise AssertionError("TCP data frame count differs from TShark")
        if f["rstFrames"] != [p["frame"] for p in observed if p["rst"]]:
            raise AssertionError("TCP RST frames mismatch")
        if f["finFrames"] != [p["frame"] for p in observed if p["fin"]]:
            raise AssertionError("TCP FIN frames mismatch")
        if f["synFrames"] != [p["frame"] for p in observed if p["syn"] and not p["ack"]]:
            raise AssertionError("TCP SYN frames mismatch")
        if f["synAckFrames"] != [p["frame"] for p in observed if p["syn"] and p["ack"]]:
            raise AssertionError("TCP SYN-ACK frames mismatch")
        if f["zeroWindowFrames"] != [p["frame"] for p in observed
                                       if p["window"] == 0 and not p["syn"]]:
            raise AssertionError("TCP zero-window frames mismatch")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True, type=Path)
    root = parser.parse_args().dir
    manifest = json.loads((root / "manifest.json").read_text())
    checked = 0
    failures = []
    for scenario in manifest["cases"]:
        try:
            verify(scenario, root)
            if scenario["mode"] == "strict":
                checked += 1
            print("PASS " + scenario["name"] + " (" + scenario["mode"] + ")")
        except Exception as exc:
            failures.append(scenario["name"] + ": " + str(exc))
            print("FAIL " + scenario["name"] + ": " + str(exc), file=sys.stderr)
    print("TCP differential: " + str(checked) + " strict comparisons across " +
          str(len(manifest["cases"])) + " scenarios.")
    if checked < 12 or failures:
        raise SystemExit("TCP conformance did not pass:\n" + "\n".join(failures))


if __name__ == "__main__":
    main()
