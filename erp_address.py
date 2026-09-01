#!/usr/bin/env python3
"""
erp_address.py — print a reachable base URL for the ERP.

The ERP has SPLIT-HORIZON DNS. Inside the office, life.gainup.in resolves to an internal
172.16.10.x address; from anywhere else the same name resolves to a public one. A machine on
a different office subnet is handed the internal address and cannot route to it, so the
dashboard and the weekly refresh both died with ETIMEDOUT on office wifi while working fine
on a phone hotspot.

So the address is DISCOVERED, not assumed: ask the system resolver AND a public resolver
(which is what defeats split-horizon), then TCP-probe each answer and print the first that
responds. No IP is written down here, so this keeps working if the public address changes.

  python3 erp_address.py                 -> http://<reachable>:8089
  ERP_HOST=… ERP_PORT=… python3 erp_address.py

Mirrors resolveErpBase() in vite.config.js — keep the two in step.
"""
import os, pathlib, socket, subprocess, sys

HOST = os.environ.get("ERP_HOST", "life.gainup.in")
PORT = int(os.environ.get("ERP_PORT", "8089"))
PUBLIC_DNS = ["8.8.8.8", "1.1.1.1"]

# Last address that actually worked. Tried FIRST, which makes the common case one fast probe
# instead of a DNS round-trip — and, more importantly, is the only thing that still works on a
# subnet where the internal address is unroutable AND outbound DNS to public resolvers is
# blocked. Both of those have been observed on this network, on different subnets.
CACHE = pathlib.Path(__file__).with_name("automation") / ".erp-address"


def cached():
    try:
        v = CACHE.read_text(encoding="utf-8").strip()
        return [v.split("//", 1)[1].rsplit(":", 1)[0]] if v.startswith("http") else []
    except (OSError, IndexError):
        return []


def remember(host):
    try:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(f"http://{host}:{PORT}\n", encoding="utf-8")
    except OSError:
        pass          # a read-only checkout is not a reason to fail the run


def reachable(host, timeout=2.0):
    try:
        with socket.create_connection((host, PORT), timeout=timeout):
            return True
    except OSError:
        return False


def system_ips():
    try:
        return sorted({ai[4][0] for ai in socket.getaddrinfo(HOST, PORT, socket.AF_INET)})
    except OSError:
        return []


def public_ips(server):
    """Ask one public resolver directly. dig first, nslookup as a fallback."""
    for cmd in (["dig", "+short", "+time=2", "+tries=1", "@" + server, HOST, "A"],
                ["nslookup", HOST, server]):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=5).stdout
        except (OSError, subprocess.SubprocessError):
            continue
        ips = [t for t in out.split()
               if t.count(".") == 3 and all(p.isdigit() and len(p) <= 3 for p in t.split("."))]
        # nslookup echoes the server's own address first; drop it
        ips = [ip for ip in ips if ip != server]
        if ips:
            return ips
    return []


def main():
    candidates, seen = [], set()
    for c in [*cached(), HOST, *system_ips(), *(ip for s in PUBLIC_DNS for ip in public_ips(s))]:
        if c not in seen:
            seen.add(c)
            candidates.append(c)

    for c in candidates:
        if reachable(c):
            remember(c)
            print(f"http://{c}:{PORT}")
            return 0
        print(f"  ERP   {c}:{PORT} did not answer — trying the next address", file=sys.stderr)

    # Nothing answered. Print the hostname so the caller's error reads "ERP unreachable"
    # rather than as a confusing bad-IP failure.
    print(f"  ERP   no address answered on port {PORT} (tried {len(candidates)})", file=sys.stderr)
    print(f"http://{HOST}:{PORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
