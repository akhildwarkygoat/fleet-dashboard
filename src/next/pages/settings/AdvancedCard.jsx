/* Advanced: the Google Maps key, export and reset. Kept last because nobody needs them day to day.
   Saving or clearing the key reloads the page, as before; reset asks once, in place. */
import React, { useRef, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { getGoogleKey, setGoogleKey } from "../../../optimiser/google.js";
import { Button, Card, CardTitle, Input, Tag } from "../../ui.jsx";
import { useFocusBack, useKept } from "../bus/parts.jsx";
import { Row, Rows } from "./parts.jsx";

export default function AdvancedCard({ onExport, onReset, toast, className }) {
  const saved = getGoogleKey();
  const [gkey, setGkey] = useKept("settings:gkey", saved);
  const [confirming, setConfirming] = useState(false);
  const resetBtn = useRef(null);
  useFocusBack(confirming, resetBtn);
  const saveKey = (val) => {
    setGoogleKey(val);
    toast(val ? "Google key saved – reloading" : "Google key cleared – reloading");
    setTimeout(() => window.location.reload(), 700);
  };

  return (
    <Card data-rise-deep className={className}>
      <CardTitle title="Advanced" />
      <Rows>
        <div className="pb-3.5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-[15px] font-semibold text-ink-2">Google Maps key</p>
            {!saved && <Tag tone="warn">Maps are off</Tag>}
          </div>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {saved ? "Saved in this browser only · maps and road distances use it" : "Needed for maps and road distances · kept in this browser only"}
          </p>
          <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); saveKey(gkey); }}>
            <div className="flex-[1_1_220px]">
              <Input value={gkey} onChange={(e) => setGkey(e.target.value)} placeholder="AIza…" aria-label="Google Maps key"
                spellCheck={false} autoComplete="off" className="font-code" />
            </div>
            <Button variant="secondary" type="submit">Save and reload</Button>
            {saved && <Button variant="ghost" onClick={() => { setGkey(""); saveKey(""); }}>Clear</Button>}
          </form>
        </div>
        <Row label="Export data" hint="Everything saved on this device, as one JSON file">
          <Button variant="secondary" size="sm" icon={Download} onClick={onExport}>Export JSON</Button>
        </Row>
        <Row label="Reset all data"
          hint={confirming ? "Metrics, variables, holidays and settings go back to the start" : "Clears this device’s copy and fetches again from the ERP"}
          hintTone={confirming ? "bad" : undefined}>
          {confirming ? (
            <>
              <Button variant="ghost" size="sm" autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
              <Button variant="danger" size="sm" icon={RotateCcw} onClick={() => { setConfirming(false); onReset(); }}>Confirm reset</Button>
            </>
          ) : (
            <Button ref={resetBtn} variant="danger" size="sm" icon={RotateCcw} onClick={() => setConfirming(true)}>Reset</Button>
          )}
        </Row>
      </Rows>
    </Card>
  );
}
