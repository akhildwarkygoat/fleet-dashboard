/* A page whose new look is not built yet: says so and links to the old look, where it works. */
import React from "react";
import { Hammer } from "lucide-react";
import { Card, Empty, PageHead } from "../ui.jsx";

export default function SoonPage({ name }) {
  return (
    <>
      <PageHead title={name} />
      <Card padding="none">
        <Empty icon={Hammer} title={`${name} gets its new look next`}
          hint={`Until then, ${name} works as before in the current dashboard.`}
          action={<a href="/" className="inline-flex h-11 items-center rounded-pill bg-ink px-5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-[background-color,transform] duration-150 hover:bg-ink-2 active:scale-[0.97]">Open the current dashboard</a>} />
      </Card>
    </>
  );
}
