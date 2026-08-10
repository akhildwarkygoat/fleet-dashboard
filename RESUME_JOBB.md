# Job B — resume after an interruption

Job B extends the 761-node Job A matrix to **938 nodes** by appending 177 new stops.
Only the pairs touching a new node are bought; the old 761×761 block is carried over free.

## To resume — run this exact command from the repo root

```bash
SSL_CERT_FILE=$(python3 -c "import certifi;print(certifi.where())") \
GOOGLE_MAPS_API_KEY="$(cat .maps_key)" \
python3 build_road_matrix.py data/bus_stops_jobB.csv --triangle --go \
  --out data/road_matrix.json --partial data/road_matrix_jobB.partial.json
```

It must print `Resuming: NNNN/4465 blocks already done`. You no longer have to police this
by eye — if the checkpoint is missing, corrupt, or built for a different node count, the
run now **refuses to start** rather than quietly re-buying everything.

Check the cost before pressing go by dropping `--go`; the dry run reads the checkpoint and
quotes only what remains:

```bash
python3 build_road_matrix.py data/bus_stops_jobB.csv --triangle --partial data/road_matrix_jobB.partial.json
```

## Do NOT

- delete `data/road_matrix_jobB.partial.json` — that IS the paid progress
- delete `data/bus_stops_jobB.csv` — the node order must stay byte-identical
- omit `--triangle` — without it the run requests the mirrored half and spends roughly double

## Checkpoint safety

Checkpoints are written to `<partial>.tmp`, fsynced, then atomically renamed over the real
file. A kill at any instant leaves the previous good checkpoint intact.

This was **not** true before 2026-08-08. The old code streamed ~16 MB straight into the
checkpoint file, so a hard kill mid-write truncated it. That is how the first Job B run lost
about 1,074 paid blocks: it died 18.7% into a write, leaving 417 `km` rows and no `min`
matrix or `done` list at all. The wreckage is kept at
`data/road_matrix_jobB.partial.TRUNCATED.json` — it is unusable, just evidence.

If a run ever dies mid-write again you may find a leftover `<partial>.tmp`. It is harmless
litter; the real checkpoint is the file without the suffix.

## Rebuilding the seed (free, no API calls)

The 2,926 pre-filled blocks are derived from the Job A matrix, so the starting checkpoint
can always be regenerated for nothing:

```bash
python3 seed_matrix_append.py data/road_matrix.PRE-JOBB.json data/new_stops_jobB.csv data/bus_stops_jobB.csv data/road_matrix_jobB.partial.json
```

This rewrites `data/bus_stops_jobB.csv` byte-identically, so the node order is preserved.

## Notes

- Any internet connection works. Unlike the ERP (which needs the office LAN or
  life.gainup.in), this only talks to maps.googleapis.com over the public internet —
  hotel wifi, tethering, anything.
- `data/road_matrix.json` is only overwritten on **successful completion**. If the run dies
  part-way it stays at the 761-node Job A version, which is valid and consistent.
- Pre-run backup: `data/road_matrix.PRE-JOBB.json`
- The 70,000 free elements are **per SKU per calendar month**. Once August's are used, add
  `--free-cap 0` to any dry run for a truthful price.
- `SSL_CERT_FILE=` is needed because this python.org Python ships no CA bundle. Running
  `"/Applications/Python 3.11/Install Certificates.command"` once removes the need for it.
