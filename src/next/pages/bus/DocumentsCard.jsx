/* Documents per bus (RC, insurance, permit…), kept in this browser under the same key, size limit and
   record shape as the old look (busDocsKey, MAX_DOC_BYTES, busDocRecord), so both looks show the same
   files. Delete is a two-step confirm in place. */
import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Trash2, Upload } from "lucide-react";
import { DOC_CATEGORIES, MAX_DOC_BYTES, busDocRecord, busDocsKey, fmtBytes } from "../../../Dashboard.jsx";
import { Badge, Button, Card, CardTitle, Empty, Field, IconButton, Select } from "../../ui.jsx";
import { count, day, plural } from "../../format.js";
import { HeadCount } from "./parts.jsx";

const read = (busId) => { try { return JSON.parse(localStorage.getItem(busDocsKey(busId)) || "[]"); } catch { return []; } };
const order = (c) => { const i = DOC_CATEGORIES.indexOf(c); return i < 0 ? DOC_CATEGORIES.length : i; };

function toBlob(dataUrl) {
  const [head, body = ""] = String(dataUrl).split(",");
  const type = (head.match(/^data:([^;,]+)/) || [])[1] || "application/octet-stream";
  const bin = atob(body);   // every record comes from readAsDataURL, which is always base64
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
/* A PDF, picture or text file opens in a new tab; anything else downloads under its own name. */
function openDoc(d) {
  const blob = toBlob(d.dataUrl);
  const url = URL.createObjectURL(blob);
  if (/^(application\/pdf|image\/|text\/)/.test(blob.type)) window.open(url, "_blank", "noopener");
  else { const a = document.createElement("a"); a.href = url; a.download = d.name; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function DocRow({ d, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useRef(null), del = useRef(null), was = useRef(false);
  // focus follows the swap both ways, so the keyboard stays on this row
  useEffect(() => {
    if (confirming && cancel.current) cancel.current.focus();
    else if (was.current && del.current) del.current.focus();
    was.current = confirming;
  }, [confirming]);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <Badge>{d.category}</Badge>
          <span className="truncate text-[15px] font-semibold text-ink" title={d.name}>{d.name}</span>
        </span>
        <span className="mt-0.5 block text-[13px] text-ink-3">{fmtBytes(d.size)} · added {day(d.addedAt)}</span>
      </span>
      {confirming ? (
        <span className="ml-auto flex gap-2">
          <Button ref={cancel} variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={() => onDelete(d.id)}>Delete file</Button>
        </span>
      ) : (
        <span className="ml-auto flex gap-1.5">
          <IconButton label={`Open ${d.name}`} icon={ExternalLink} variant="satin" size="sm" onClick={() => openDoc(d)} />
          <IconButton ref={del} label={`Delete ${d.name}`} icon={Trash2} variant="satin" size="sm" onClick={() => setConfirming(true)}
            className="!bg-bad-soft !text-bad-ink hover:!bg-bad-hover" />
        </span>
      )}
    </li>
  );
}

export default function DocumentsCard({ busId, toast }) {
  const [docs, setDocs] = useState(() => read(busId));
  const [cat, setCat] = useState(DOC_CATEGORIES[0]);
  const file = useRef(null), add = useRef(null);
  const save = (next) => {
    try { localStorage.setItem(busDocsKey(busId), JSON.stringify(next)); }
    catch { toast("Storage is full. Remove some files first."); return false; }
    setDocs(next);
    return true;
  };

  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const added = [];
    let pending = files.length;
    // added to the list as stored when the last file is read, so a delete made meanwhile stays deleted
    const done = () => {
      if (--pending > 0 || !added.length) return;
      if (save([...read(busId), ...added])) toast(added.length === 1 ? "Document added" : `${plural(added.length, "document", "documents")} added`);
    };
    files.forEach((f) => {
      if (f.size > MAX_DOC_BYTES) { toast(`${f.name} is too large (max ${fmtBytes(MAX_DOC_BYTES)})`); done(); return; }
      const reader = new FileReader();
      reader.onload = () => { added.push(busDocRecord(f, cat, reader.result)); done(); };
      reader.onerror = done;
      reader.readAsDataURL(f);
    });
  };

  const remove = (id) => {
    if (save(read(busId).filter((x) => x.id !== id)) && add.current) add.current.focus();
  };

  const sorted = docs.slice().sort((a, b) => order(a.category) - order(b.category));
  return (
    <Card data-rise-deep>
      <CardTitle title={<>Documents{docs.length > 0 && <HeadCount>{count(docs.length)}</HeadCount>}</>} sub="Saved in this browser" />
      <div className="mb-2 flex flex-wrap items-end gap-3">
        <Field label="Type of document" className="min-w-[150px] flex-1">
          <Select value={cat} onChange={(e) => setCat(e.target.value)}>
            {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <input ref={file} type="file" multiple onChange={onPick} className="hidden" />
        <Button ref={add} variant="secondary" icon={Upload} onClick={() => file.current.click()}>Add document</Button>
      </div>
      {sorted.length ? (
        <ul className="divide-y divide-line">
          {sorted.map((d) => <DocRow key={d.id} d={d} onDelete={remove} />)}
        </ul>
      ) : <Empty icon={FileText} title="No documents yet" hint="Add the RC, insurance or permit for this bus." className="!py-8" />}
    </Card>
  );
}
