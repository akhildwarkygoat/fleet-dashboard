/* Custom metrics and the variables they can use. A metric is added or changed in a centred card
   with the chip formula editor; what was typed survives leaving the page. Saving follows the old
   form exactly: a name and a formula that works out on the sample bus, decimals read as a whole
   number, bands kept only when switched on and not empty. */
import React, { useId, useState } from "react";
import { Pencil, Plus, Sigma, Variable } from "lucide-react";
import { FORMULA_VARS, THEMES, evalFormula, exprToTokens, fmtFormula, sortedBands, tokensToExpr, uid, varMapOf } from "../../../Dashboard.jsx";
import { Button, Card, CardTitle, CentreCard, Choice, Field, IconButton, Input, cx } from "../../ui.jsx";
import { MINUS } from "../../format.js";
import { useKept } from "../bus/parts.jsx";
import { FormulaBox, FormulaKeys, SAMPLE, SAMPLE_TEXT, SAMPLE_TITLE, exprFace } from "./FormulaEditor.jsx";
import { BandRows, Group, OnOff, RemoveSwap, Rows } from "./parts.jsx";

const UNITS = [["", "Number"], ["₹", "₹"], ["%", "%"], ["km", "km"]];
const DECIMALS = ["0", "1", "2", "3", "4"].map((d) => [d, d]);
const BLANK = { name: "", unit: "", decimals: "0", description: "" };
// the Bus page's own formatter, with the sign written first as a true minus
const shown = (val, f) => fmtFormula(val, f).replace(/^₹-/, MINUS + "₹").replace(/^-/, MINUS);

const draftFor = (m) => (m ? {
  id: m.id,
  f: { name: m.name, unit: m.unit || "", decimals: String(m.decimals ?? 0), description: m.description || "" },
  tokens: exprToTokens(m.expr),
  bands: m.bands ? m.bands.map((b) => ({ ...b })) : [],
  showBands: !!(m.bands && m.bands.length),
  error: "",
} : { id: null, f: BLANK, tokens: [], bands: [], showBands: false, error: "" });

function MetricEditor({ draft, setDraft, variables, onAdd, onUpdate }) {
  const previewId = useId();
  const { f, tokens } = draft;
  const patch = (p) => setDraft((d) => ({ ...d, ...p, error: "" }));
  const setF = (k) => (v) => patch({ f: { ...f, [k]: v } });
  const expr = tokensToExpr(tokens);
  const preview = expr ? evalFormula(expr, SAMPLE, varMapOf(variables)) : undefined;
  const bandUnit = f.unit === "%" || f.unit === "km" || f.unit === "₹" ? f.unit : "";

  const submit = () => {
    if (!f.name || !expr || preview == null) return setDraft((d) => ({ ...d, error: "Enter a name and a formula that works out" }));
    const fm = { id: draft.id || uid(), name: f.name, expr, unit: f.unit, decimals: parseInt(f.decimals || "0"), description: f.description,
      bands: draft.showBands && draft.bands.length ? draft.bands : undefined };
    (draft.id ? onUpdate : onAdd)(fm);
    setDraft(null);
  };
  const toggleBands = (on) => patch({ showBands: on, bands: on && !draft.bands.length ? [{ id: uid(), label: "Good", min: 0, color: THEMES.light.good }] : draft.bands });

  return (
    <CentreCard open title={draft.id ? "Edit metric" : "Add metric"} width={880} onClose={() => setDraft(null)}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {draft.error && <p role="alert" className="mr-auto text-[13px] font-medium text-bad-ink">{draft.error}</p>}
          <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="primary" icon={draft.id ? Pencil : Plus} onClick={submit}>{draft.id ? "Save metric" : "Add metric"}</Button>
        </div>
      }>
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          <Field label="Name">
            <Input value={f.name} onChange={(e) => setF("name")(e.target.value)} placeholder="Cost per seat" />
          </Field>
          <Group label="Formula">
            <FormulaBox tokens={tokens} setTokens={(t) => patch({ tokens: t })} describedBy={previewId} />
            <p id={previewId} className="min-h-6 text-[13px] text-ink-3" title={SAMPLE_TITLE}>
              {preview === undefined ? `Result for a sample bus: ${SAMPLE_TEXT}`
                : preview == null ? <span className="font-medium text-bad-ink">This does not work out yet. Check for a missing number or bracket.</span>
                : <>Result for a sample bus <b className="ml-1 text-[15px] font-bold tabular-nums text-ink">{shown(preview, { unit: f.unit, decimals: parseInt(f.decimals || "0") })}</b></>}
            </p>
          </Group>
          <Group label="Shown as">
            <Choice label="Shown as" value={f.unit} options={UNITS} onChange={setF("unit")} />
          </Group>
          <Group label="Decimals">
            <Choice label="Decimals" value={f.decimals} options={DECIMALS} onChange={setF("decimals")} />
          </Group>
          <Field label="Description (optional)">
            <Input value={f.description} onChange={(e) => setF("description")(e.target.value)} placeholder="What it means, in one line" />
          </Field>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <FormulaKeys tokens={tokens} setTokens={(t) => patch({ tokens: t })} variables={variables} />
          <Group label="Colour bands (optional)">
            <OnOff label="Colour bands for this metric" on={draft.showBands} onChange={toggleBands} />
          </Group>
        </div>
        {draft.showBands && (
          <div className="md:col-span-2"><BandRows bands={draft.bands} setBands={(b) => patch({ bands: b })} unit={bandUnit} /></div>
        )}
      </div>
    </CentreCard>
  );
}

function MetricRow({ m, onEdit, onDel }) {
  const bands = m.bands && m.bands.length ? sortedBands(m.bands) : null;
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold text-ink">
          {m.name}{m.unit && <span className="text-[13px] font-medium text-ink-3">{m.unit}</span>}
        </p>
        {m.description && <p className="mt-0.5 text-[13px] text-ink-3">{m.description}</p>}
        <p className="mt-0.5 break-words font-code text-[13px] text-ink-2">{exprFace(m.expr)}</p>
        {bands && (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-3">
            {bands.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 rounded-pill" style={{ background: b.color }} />{b.label} from {b.min}
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <RemoveSwap name={m.name} onRemove={onDel}>
          <IconButton label={`Edit ${m.name}`} icon={Pencil} variant="ghost" size="sm" onClick={onEdit} />
        </RemoveSwap>
      </div>
    </div>
  );
}

export function MetricsCard({ formulas, variables, onAdd, onUpdate, onDel, className }) {
  const [draft, setDraft] = useKept("settings:metric", null);
  const open = (m) => setDraft(draftFor(m));
  const add = <Button variant="primary" size="sm" icon={Plus} onClick={() => open(null)}>Add metric</Button>;
  return (
    <Card data-rise-deep className={className}>
      <CardTitle title="Custom metrics" sub="Your own figures for every bus, worked out from a formula" right={formulas.length > 0 && add} />
      {formulas.length ? (
        <Rows>
          {formulas.map((m) => <MetricRow key={m.id} m={m} onEdit={() => open(m)} onDel={() => onDel(m.id)} />)}
        </Rows>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-tile bg-satin px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-white text-ink-2 shadow-chip">
            <Sigma size={18} strokeWidth={2} aria-hidden />
          </span>
          <p className="min-w-0 flex-1 text-[13px] text-ink-2">No custom metrics yet. Add one to work out your own figure for every bus.</p>
          {add}
        </div>
      )}
      {draft && <MetricEditor draft={draft} setDraft={setDraft} variables={variables} onAdd={onAdd} onUpdate={onUpdate} />}
    </Card>
  );
}

/* Variables: fixed numbers typed by hand (the number of tailors) that no feed can give. A name is
   letters, digits and underscores, starting with a letter or underscore, and not already taken. */
export function VariablesCard({ variables, onAdd, onUpdate, onDel, className }) {
  const [nv, setNv] = useKept("settings:variable", { name: "", value: "" });
  const [error, setError] = useState("");
  const add = (e) => {
    e.preventDefault();
    const name = nv.name.trim();
    if (!/^[a-zA-Z_]\w*$/.test(name)) return setError("Use letters and digits only, no spaces, starting with a letter, like tailors");
    if (FORMULA_VARS.includes(name) || variables.some((v) => v.name === name)) return setError("That name is already taken");
    onAdd({ id: uid(), name, value: Number(nv.value) || 0 });
    setNv({ name: "", value: "" });
  };
  return (
    <Card data-rise-deep className={className}>
      <CardTitle title="Variables" sub="Fixed numbers for your formulas, such as the number of tailors" />
      {variables.length > 0 && (
        <Rows>
          {variables.map((v) => (
            <div key={v.id} className="flex items-center gap-3 py-2.5 first:pt-0">
              <span className="min-w-0 flex-1 truncate font-code text-[15px] font-semibold text-ink">{v.name}</span>
              <span className="w-28 shrink-0">
                <Input type="number" value={v.value} aria-label={`Value of ${v.name}`} className="text-right tabular-nums"
                  onChange={(e) => onUpdate({ ...v, value: Number(e.target.value) || 0 })} />
              </span>
              <RemoveSwap name={v.name} onRemove={() => onDel(v.id)} />
            </div>
          ))}
        </Rows>
      )}
      <form onSubmit={add} className={cx("flex flex-wrap items-start gap-2", variables.length > 0 && "mt-3")}>
        <Field label="Name" error={error} className="flex-[2_1_160px]">
          <Input value={nv.name} placeholder="tailors" onChange={(e) => { setNv({ ...nv, name: e.target.value }); setError(""); }} className="font-code" />
        </Field>
        <Field label="Value" className="flex-[1_1_96px]">
          <Input type="number" value={nv.value} placeholder="0" onChange={(e) => setNv({ ...nv, value: e.target.value })} className="text-right tabular-nums" />
        </Field>
        <Button variant="secondary" type="submit" icon={Variable} className="w-full sm:mt-[22px] sm:w-auto">Add variable</Button>
      </form>
    </Card>
  );
}
