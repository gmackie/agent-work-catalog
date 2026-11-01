#!/usr/bin/env python3
"""Public, deterministic PCAP corpus independently built using Scapy.

This is not a recorded customer or industrial network capture.
TShark independently interprets the frames in a separate CI job.
"""
from __future__ import annotations

import argparse
import json
import struct
from decimal import Decimal
from pathlib import Path
from typing import Any

from scapy.all import Dot1Q, Ether, IP, IPv6, Raw, TCP, wrpcap  # type: ignore
from scapy.layers.inet import IPOption_NOP  # type: ignore
from scapy.utils import PcapNgWriter  # type: ignore

BASE = 1700000000
CLIENT, SERVER = "192.0.2.10", "192.0.2.20"


def adu(tid: int, pdu: bytes, unit: int = 1, protocol: int = 0) -> bytes:
    return struct.pack("!HHHB", tid, protocol, len(pdu) + 1, unit) + pdu


def pdu(function: int, response: bool, exception: int | None = None) -> bytes:
    if exception is not None:
        if not response:
            raise ValueError("Only responses may have Modbus exceptions")
        return bytes((function | 0x80, exception))
    return (bytes((function, 4, 0, 1, 0, 2)) if response
            else bytes((function, 0, 0, 0, 2)))


class Scenario:
    def __init__(self, name: str):
        self.name = name
        self.packets: list[Any] = []
        self.messages: list[dict[str, Any]] = []
        self.seq: dict[tuple[str, str, int, int], int] = {}

    def add(self, direction: str, tid: int, function: int = 3, *,
            exception: int | None = None, client: str = CLIENT,
            client_port: int = 40000, unit: int = 1, us: int = 0,
            vlan: int = 0, ip_options: bool = False, tcp_options: bool = False,
            other_port: bool = False, raw: bytes | None = None,
            ipv6: bool = False, fragment: bool = False,
            decoded: bool = True) -> None:
        response = direction == "response"
        src, dst = (SERVER, client) if response else (client, SERVER)
        sport, dport = ((502, client_port) if response
                        else (client_port, 8080 if other_port else 502))
        payload = raw if raw is not None else adu(tid, pdu(function, response, exception), unit)
        network = (IPv6(src="2001:db8::2" if response else "2001:db8::1",
                        dst="2001:db8::1" if response else "2001:db8::2")
                   if ipv6 else
                   IP(src=src, dst=dst, flags="MF" if fragment else 0,
                      options=[IPOption_NOP()] if ip_options else []))
        flow = (src, dst, sport, dport)
        seq = self.seq.get(flow, 5000 if response else 1000)
        tcp = TCP(sport=sport, dport=dport, flags="PA", seq=seq, ack=0,
                  options=[("MSS", 1460)] if tcp_options else [])
        self.seq[flow] = seq + len(payload)
        if vlan == 1:
            packet = Ether() / Dot1Q(vlan=23) / network / tcp / Raw(payload)
        elif vlan == 2:
            packet = (Ether(type=0x88A8) /
                      Dot1Q(vlan=100, type=0x8100) /
                      Dot1Q(vlan=200, type=0x86DD if ipv6 else 0x0800) /
                      network / tcp / Raw(payload))
        else:
            packet = Ether() / network / tcp / Raw(payload)
        packet.time = Decimal(BASE) + Decimal(us) / Decimal(1000000)
        self.packets.append(packet)
        if decoded and not (other_port or ipv6 or fragment):
            self.messages.append({
                "frame": len(self.packets), "tid": tid, "unit": unit,
                "function": function, "exception": exception,
                "src": src, "dst": dst, "sport": sport, "dport": dport,
            })


def cases() -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []

    def add(s: Scenario, pairs: list[tuple[int, int, int, int, int | None]] | None = None,
            *, unanswered: int = 0, unmatched: int = 0, exceptions: int = 0,
            mode: str = "strict", error: str | None = None) -> None:
        results.append({
            "name": s.name, "packets": s.packets, "messages": s.messages,
            "pairs": [
                {"requestFrame": a, "responseFrame": b, "tid": tid,
                 "function": func, "exception": exc}
                for a, b, tid, func, exc in (pairs or [])
            ],
            "findingCounts": {
                "unanswered_observed": unanswered,
                "unmatched_response": unmatched,
                "exception_response": exceptions,
            }, "mode": mode, "error": error,
        })

    s = Scenario("read_holding_ok")
    s.add("request", 1, us=10000)
    s.add("response", 1, us=45000)
    add(s, [(1, 2, 1, 3, None)])

    s = Scenario("exception_illegal_address")
    s.add("request", 42, us=2000)
    s.add("response", 42, exception=2, us=47000)
    add(s, [(1, 2, 42, 3, 2)], exceptions=1)

    s = Scenario("pipelined_out_of_order")
    s.add("request", 20, us=5000)
    s.add("request", 21, function=4, us=14000)
    s.add("response", 21, function=4, us=44000)
    s.add("response", 20, us=70000)
    add(s, [(1, 4, 20, 3, None), (2, 3, 21, 4, None)])

    s = Scenario("unanswered_request")
    s.add("request", 30, us=1000)
    add(s, unanswered=1)

    s = Scenario("response_only")
    s.add("response", 31, us=1000)
    add(s, unmatched=1)

    s = Scenario("two_clients_same_transaction_id")
    s.add("request", 55, client=CLIENT, client_port=40000, us=1000)
    s.add("request", 55, client="192.0.2.11", client_port=40001, us=3000)
    s.add("response", 55, client="192.0.2.11", client_port=40001, us=17000)
    s.add("response", 55, client=CLIENT, client_port=40000, us=21000)
    add(s, [(1, 4, 55, 3, None), (2, 3, 55, 3, None)])

    s = Scenario("vlan_8021q")
    s.add("request", 61, us=2000, vlan=1)
    s.add("response", 61, us=17000, vlan=1)
    add(s, [(1, 2, 61, 3, None)])

    s = Scenario("double_vlan_qinq")
    s.add("request", 62, us=2000, vlan=2)
    s.add("response", 62, us=23000, vlan=2)
    add(s, [(1, 2, 62, 3, None)])

    s = Scenario("ipv4_tcp_options")
    s.add("request", 63, us=1000, ip_options=True, tcp_options=True)
    s.add("response", 63, us=37000, ip_options=True, tcp_options=True)
    add(s, [(1, 2, 63, 3, None)])

    s = Scenario("unrelated_tcp_and_modbus")
    s.add("request", 0, us=1000, other_port=True)
    s.add("request", 64, us=10000)
    s.add("response", 64, us=29000)
    add(s, [(2, 3, 64, 3, None)])

    s = Scenario("big_endian_pcap")
    s.add("request", 65, us=1000)
    s.add("response", 65, us=51000)
    add(s, [(1, 2, 65, 3, None)])

    s = Scenario("nanosecond_pcap")
    s.add("request", 66, us=1000)
    s.add("response", 66, us=73000)
    add(s, [(1, 2, 66, 3, None)])

    # Deliberately outside the strict per-frame interoperability claim.
    s = Scenario("coalesced_adus")
    payload = adu(71, pdu(3, False)) + adu(72, pdu(4, False))
    s.add("request", 71, raw=payload, us=1000, decoded=False)
    add(s, mode="parser-only", unanswered=2)

    s = Scenario("partial_tcp_adu")
    payload = adu(73, pdu(3, False))
    s.add("request", 73, raw=payload[:5], us=1000, decoded=False)
    s.add("request", 73, raw=payload[5:], us=2000, decoded=False)
    add(s, mode="parser-only")

    s = Scenario("ipv6_unsupported")
    s.add("request", 74, ipv6=True, decoded=False)
    add(s, mode="parser-only")

    s = Scenario("fragmented_ipv4_unsupported")
    s.add("request", 75, fragment=True, decoded=False)
    add(s, mode="parser-only")

    s = Scenario("malformed_protocol_id")
    s.add("request", 76, raw=adu(76, pdu(3, False), protocol=1), decoded=False)
    add(s, mode="parser-only")

    s = Scenario("tcp_retransmission")
    s.add("request", 79, us=1000)
    # Force the same sender TCP sequence number for an actual retransmission.
    s.seq[(CLIENT, SERVER, 40000, 502)] -= len(adu(79, pdu(3, False)))
    s.add("request", 79, us=12000)
    s.add("response", 79, us=35000)
    add(s, mode="parser-only", unanswered=1)

    s = Scenario("invalid_mbap_length")
    s.add("request", 80, raw=struct.pack("!HHHB", 80, 0, 0, 1) + b"\x03",
          decoded=False)
    add(s, mode="parser-only")

    s = Scenario("pcapng_unsupported")
    s.add("request", 81, us=1000)
    add(s, mode="reject", error="unsupported")

    s = Scenario("truncated_record")
    s.add("request", 77, us=1000)
    add(s, mode="reject", error="invalid")
    return results


def convert_endianness(original: bytes, nanos: bool) -> bytes:
    if original[:4] != b"\xd4\xc3\xb2\xa1":
        raise RuntimeError("Scapy did not emit little-endian classic PCAP")
    endian = "<" if nanos else ">"
    magic = 0xA1B23C4D if nanos else 0xA1B2C3D4
    out = bytearray(struct.pack(endian + "IHHIIII", magic, 2, 4, 0, 0, 65535, 1))
    offset = 24
    while offset < len(original):
        sec, subsec, included, orig = struct.unpack_from("<IIII", original, offset)
        offset += 16
        out.extend(struct.pack(endian + "IIII", sec, subsec * 1000 if nanos else subsec,
                               included, orig))
        out.extend(original[offset:offset+included])
        offset += included
    return bytes(out)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    directory = parser.parse_args().out.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    entries = []
    for scenario in cases():
        name = scenario.pop("name")
        packets = scenario.pop("packets")
        filename = name + ".pcap"
        path = directory / filename
        if name == "pcapng_unsupported":
            # A real pcapng capture, not merely a fake magic header.
            writer = PcapNgWriter(str(path))
            try:
                for packet in packets:
                    writer.write(packet)
            finally:
                writer.close()
        else:
            wrpcap(str(path), packets)
        if name == "big_endian_pcap":
            path.write_bytes(convert_endianness(path.read_bytes(), False))
        if name == "nanosecond_pcap":
            path.write_bytes(convert_endianness(path.read_bytes(), True))
        if name == "truncated_record":
            path.write_bytes(path.read_bytes()[:-3])
        entries.append({"name": name, "file": filename, **scenario})
    (directory / "manifest.json").write_text(
        json.dumps({"schemaVersion": "awc.pcap-conformance/v1",
                    "generator": "Scapy independent Python packet construction",
                    "cases": entries}, indent=2) + "\n", encoding="utf-8")
    print("Generated " + str(len(entries)) + " synthetic corpus cases")


if __name__ == "__main__":
    main()
