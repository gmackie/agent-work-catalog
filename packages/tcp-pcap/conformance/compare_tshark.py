#!/usr/bin/env python3
"""Independently validate bounded AWC TCP frame fields against Scapy and TShark."""
import argparse,json,hashlib,shutil,subprocess
from pathlib import Path
from collections import Counter
FIELDS=["frame.number","ip.src","ip.dst","tcp.srcport","tcp.dstport",
        "tcp.seq_raw","tcp.ack_raw","tcp.flags.syn","tcp.flags.ack",
        "tcp.flags.fin","tcp.flags.reset","tcp.window_size_value","tcp.len"]
def tshark(path:Path):
    cmd=["tshark","-n","-r",str(path),"-Y","tcp","-T","fields",
         "-E","separator=/t","-E","quote=n"]
    for field in FIELDS:cmd+=["-e",field]
    result=subprocess.run(cmd,text=True,capture_output=True,check=False)
    if result.returncode:raise AssertionError("TShark failed: "+result.stderr[-900:])
    rows=[]
    def bit(value:str)->bool:
        normalized=value.strip().lower()
        if normalized in ("1","true","set"):return True
        if normalized in ("0","false","not set",""):return False
        raise AssertionError("Unexpected TShark boolean field: "+repr(value))
    for line in result.stdout.splitlines():
        fields=line.split("\t")
        if len(fields)!=len(FIELDS):raise AssertionError("Unexpected oracle data: "+repr(line))
        frame,src,dst,sp,dp,seq,ack,syn,ackf,fin,rst,window,n=fields
        rows.append({"frame":int(frame),"source":src,"destination":dst,
          "sport":int(sp),"dport":int(dp),"sequence":int(seq),"ack":int(ack),
          "syn":bit(syn),"ackFlag":bit(ackf),"fin":bit(fin),"rst":bit(rst),
          "window":int(window),"payload":int(n)})
    return rows
def check(root:Path,case):
    file=root/case["file"]
    a=json.loads((root/"reports"/(case["name"]+".json")).read_text())
    if a["captureSha256"]!=hashlib.sha256(file.read_bytes()).hexdigest():
        raise AssertionError("Capture digest mismatch")
    t=tshark(file)
    if t!=case["rows"]:raise AssertionError("Scapy/TShark fields differ: "+repr((case["rows"],t)))
    parsed=[{"frame":x["frame"],"source":x["source"],"destination":x["destination"],
        "sport":x["sourcePort"],"dport":x["destinationPort"],
        "sequence":x["sequence"],"ack":x["acknowledgment"],"syn":x["syn"],
        "ackFlag":x["ack"],"fin":x["fin"],"rst":x["rst"],
        "window":x["advertisedWindow"],"payload":x["payloadBytes"]} for x in a["segments"]]
    if parsed!=t:raise AssertionError("AWC/TShark packet fields differ: "+repr((t,parsed)))
    counts=Counter(x["kind"] for x in a["observations"])
    for kind,n in case["counts"].items():
        if counts[kind]!=n:
            raise AssertionError(kind+" "+str(counts[kind])+" not "+str(n))
    if case["handshake"] is not None:
        if len(a["flows"])!=1 or a["flows"][0].get("handshakeSynToSynAckMs")!=case["handshake"]:
            raise AssertionError("Handshake delay mismatch")
    print("PASS",case["name"],len(t),"TCP frames")
def main():
    arg=argparse.ArgumentParser();arg.add_argument("--dir",type=Path,required=True)
    root=arg.parse_args().dir.resolve()
    if not shutil.which("tshark"):raise SystemExit("TShark required, no fallback")
    manifest=json.loads((root/"manifest.json").read_text())
    if manifest["schema"]!="awc.tcp-corpus/v1":raise AssertionError("Unknown corpus")
    for case in manifest["cases"]:check(root,case)
    print("Total independently compared:",len(manifest["cases"]))
    print("Oracle version:",subprocess.run(["tshark","--version"],
        text=True,capture_output=True).stdout.splitlines()[0])
if __name__=="__main__":main()
