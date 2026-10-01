/* A frosted round button that appears once a long list has scrolled the page, and takes it back
   to the top. On a phone it sits above the bottom bar; on desk, in the corner beside it. */
import React, { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

export default function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 500);
    window.addEventListener("scroll", on, { passive: true });
    on();
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (!show) return null;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <button type="button" aria-label="Back to top" title="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" })}
      className="glass fixed bottom-28 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-pill text-ink shadow-float transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.94] sm:bottom-6 sm:right-6">
      <ArrowUp size={20} strokeWidth={2} aria-hidden />
    </button>
  );
}
