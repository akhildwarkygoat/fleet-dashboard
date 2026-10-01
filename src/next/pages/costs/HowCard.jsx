/* How every cost is worked out: the page whose job is explaining ("i want u to explain everything").
   The same explainers are the Excel file's last sheet (costExplainers in costReport.js). What a cost
   is already shows under its line in Where the money goes, so here only the costs not listed there
   keep it; how each is worked out shows for all. Flowed in columns so uneven entries leave no holes. */
import React from "react";
import { Card, CardTitle } from "../../ui.jsx";

/** `explainers` from pageExplainers; `listed` the keys of the cost lines on screen. */
export default function HowCard({ explainers, listed }) {
  return (
    <Card>
      <CardTitle title="How every cost is worked out" sub="The same explanations are the last sheet of the Excel file" />
      <div className="gap-x-10 md:columns-2 xl:columns-3">
        {explainers.map((e) => (
          <div key={e.key} className="mb-5 break-inside-avoid last:mb-0">
            <h3 className="text-[15px] font-semibold text-ink">{e.title}</h3>
            {!(listed && listed.has(e.key)) && <p className="mt-0.5 text-[14px] leading-snug text-ink-2">{e.what}</p>}
            <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{e.how}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
