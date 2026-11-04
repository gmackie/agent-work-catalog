# Independent Modbus/TCP PCAP conformance suite

**Scope:** a bounded packet-evidence pilot, not a full Modbus/TCP dissector or safety assessment.

## How we test independently

Scapy 2.6.1 produces public synthetic Ethernet/IPv4/TCP/Modbus packets in a classic PCAP corpus, separately from the production TypeScript fixture builder. The AWC TypeScript parser and the installed TShark binary decode the same files independently.

For the strict subset, the comparator fails CI when TShark and Scapy fixture intent disagree on source/destination IPs and TCP ports, transaction ID, unit ID, function code, exception code or frame number. It also checks AWC's matched request/response frame pairs, unanswered requests, capture SHA-256, complete ADU count and response times against TShark's frame.time_epoch values.

**This is an on-wire differential check, not independent expert validation or proof of capture completeness.** The 2026-11-01 initial job used TShark 4.6.4; later Ubuntu package updates may change this version. Scapy is pinned; TShark is currently recorded in logs rather than version-pinned.

## Corpus matrix

| Scenario | Classification | Rationale |
| --- | --- | --- |
| Basic read holding registers | strict TShark | Modbus FC03 and latency |
| Illegal data address exception | strict TShark | Function/exception code |
| Pipelined/out-of-order replies | strict TShark | Transaction identity, not frame adjacency |
| No response in capture | strict TShark | Never infer actual PLC timeout |
| Response without captured request | strict TShark | No fabricated request |
| Identical transaction ID from two clients | strict TShark | Flow separation |
| 802.1Q VLAN | strict TShark | Ethernet offsets |
| QinQ double VLAN | strict TShark | Stacked tags |
| IPv4/TCP options | strict TShark | Variable header lengths |
| Unrelated HTTP TCP then Modbus | strict TShark | Correct protocol selection |
| Big-endian classic PCAP | strict TShark | Endianness |
| Nanosecond classic PCAP | strict TShark | Capture precision |
| Multiple ADUs in one segment | parser-only | Not counted as Wireshark parity |
| Split TCP ADU | parser-only | TCP reassembly is unsupported |
| IPv6 Modbus | parser-only | IPv6 is unsupported |
| Fragmented IPv4 | parser-only | IPv4 reconstruction is unsupported |
| Invalid MBAP protocol ID | parser-only | Explicit malformed finding |
| TCP retransmission | parser-only | Known duplicate-request limitation |
| Invalid MBAP length | parser-only | Explicit malformed finding |
| Valid pcapng | expected rejection | TShark independently opens it; AWC does not support it |
| Truncated PCAP record | expected rejection | Packet framing safety |

The parser-only lane is deliberately not presented as differential agreement. In particular, the current parser may count a TCP retransmission as an additional unanswered request: this is a documented limitation, not a new diagnosis.

Separately, a deterministic 1,200-seed malformed-PCAP mutation test checks that the parser returns bounded reports or typed CaptureError failures rather than crashing or returning unbounded output. This is **not coverage-guided fuzzing**.

## Running locally

Requirements: Python 3.12+, Scapy 2.6.1, TShark, Node 24+, pnpm 10.

    python -m pip install scapy==2.6.1
    pnpm install --no-frozen-lockfile
    tshark --version
    python packages/modbus-pcap/conformance/generate_corpus.py --out /tmp/awc-pcap-conformance
    pnpm exec tsx packages/modbus-pcap/conformance/analyze_corpus.ts /tmp/awc-pcap-conformance
    python packages/modbus-pcap/conformance/compare_tshark.py --dir /tmp/awc-pcap-conformance

GitHub Actions independently runs the above in .github/workflows/pcap-differential.yml. It installs TShark from the Ubuntu apt repository and archives only **synthetic** captures on failure, for seven days. This job must **fail**, not skip, when TShark is unavailable or fields cannot be compared.

No actual customer PCAPs, device secrets, or real-money payment credentials are included.

## Release gates

Before making broader diagnostic or professional claims: add a sanitized, consented real-world reference corpus; compare against version-pinned TShark and a second parser; add TCP stream reassembly and retransmission tracking if advertised; test pcapng, IPv6 and fragmentation when implemented; perform coverage-guided fuzzing and an independent security review; clarify operational data retention and privacy obligations.

A broker-signed Attest-shaped report still proves attribution, not independent professional competence, authority, active credential status, or payment settlement.

References:
- https://www.wireshark.org/docs/dfref/m/mbtcp.html
- https://www.wireshark.org/docs/dfref/m/modbus.html
- https://www.wireshark.org/docs/man-pages/tshark.html
- https://scapy.readthedocs.io/en/stable/usage.html
- https://www.modbus.org/modbus-specifications
