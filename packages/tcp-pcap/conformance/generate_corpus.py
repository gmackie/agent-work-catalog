#!/usr/bin/env python3
"""Scapy-built public synthetic TCP corpus independent of AWC's packet parser."""
import argparse,json
from pathlib import Path
from decimal import Decimal
from scapy.all import Ether,IP,TCP,Raw,wrpcap  # type: ignore
A,B="192.0.2.10","192.0.2.20"
def p(src,dst,sp,dp,seq,ack,flags,win,us,data=b""):
    packet=Ether()/IP(src=src,dst=dst)/TCP(sport=sp,dport=dp,seq=seq,ack=ack,flags=flags,window=win)/Raw(data)
    packet.time=Decimal(1700000000)+Decimal(us)/Decimal(1000000)
    return packet
def cases():
    result=[]
    def add(name,steps,counts=None,delay=None):
        packets=[p(*x) for x in steps]
        rows=[]
        for i,(src,dst,sp,dp,seq,ack,flags,win,us,data) in enumerate(steps):
            rows.append({"frame":i+1,"source":src,"destination":dst,
                "sport":sp,"dport":dp,"sequence":seq,"ack":ack,
                "syn":"S" in flags,"ackFlag":"A" in flags,"fin":"F" in flags,
                "rst":"R" in flags,"window":win,"payload":len(data)})
        result.append({"name":name,"packets":packets,"rows":rows,
            "counts":counts or {},"handshake":delay})
    add("handshake",[(A,B,40000,443,100,0,"S",8192,10000,b""),
        (B,A,443,40000,900,101,"SA",8192,40000,b""),
        (A,B,40000,443,101,901,"A",8192,45000,b""),
        (A,B,40000,443,101,901,"PA",8192,50000,b"hello")],
        {"syn_observed":1,"syn_ack_observed":1},30.0)
    add("zero_window_rst",[(A,B,40001,502,1000,0,"PA",8192,10000,b"abc"),
        (B,A,502,40001,4000,1003,"A",0,20000,b""),
        (B,A,502,40001,4000,1003,"RA",8192,30000,b"")],
        {"zero_window_advertised":1,"rst_observed":1})
    add("repeat_range",[(A,B,40002,502,2000,0,"PA",8192,10000,b"abcd"),
        (A,B,40002,502,2000,0,"PA",8192,22000,b"abcd")],
        {"duplicate_sequence_range":1})
    add("gap_observed",[(A,B,40003,502,10000,0,"PA",8192,10000,b"abcd"),
        (A,B,40003,502,10010,0,"PA",8192,24000,b"efgh")],
        {"sequence_gap_observed":1})
    add("two_flows",[(A,B,41000,502,100,0,"PA",8192,1000,b"a"),
        ("192.0.2.11",B,41001,502,100,0,"PA",8192,2000,b"b"),
        (B,"192.0.2.11",502,41001,500,101,"PA",8192,3000,b"c")])
    add("fin_close",[(A,B,42000,443,100,0,"FA",8192,1000,b""),
        (B,A,443,42000,900,101,"FA",8192,19000,b""),
        (A,B,42000,443,101,901,"A",8192,22000,b"")])
    add("overlap",[(A,B,44000,443,1000,0,"PA",8192,1000,b"abcdef"),
        (A,B,44000,443,1004,0,"PA",8192,2000,b"cdef")],
        {"overlapping_sequence_range":1})
    add("multiport",[(A,B,12345,80,100,0,"PA",8192,10000,b"GET /"),
        (A,B,12346,502,100,0,"PA",8192,14000,b"\x00\x01")])
    return result
def main():
    parser=argparse.ArgumentParser();parser.add_argument("--out",type=Path,required=True)
    root=parser.parse_args().out.resolve();root.mkdir(parents=True,exist_ok=True)
    catalog=[]
    for case in cases():
        name=case["name"];wrpcap(str(root/(name+".pcap")),case["packets"])
        catalog.append({k:v for k,v in case.items() if k!="packets"}|{"file":name+".pcap"})
    (root/"manifest.json").write_text(json.dumps({"schema":"awc.tcp-corpus/v1","cases":catalog},indent=2)+"\n")
    print("Generated",len(catalog),"public synthetic TCP fixtures")
if __name__=="__main__":main()
