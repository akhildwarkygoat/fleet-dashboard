/* The new look's building blocks. Small on purpose: only what the screens need.

   Hierarchy by fill, never by outline: ink = do it, blue = start the one important thing,
   satin = an alternative, text only = leave, soft red = destructive. Every control is a pill.
   Cards float on shadows; nothing has a border. Status colours are soft tints with darker text. */
import React, { forwardRef, useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ChevronRight, RotateCw, Search as SearchIcon, X } from "lucide-react";
import { gsap, motion } from "./motion.js";
import { DASH } from "./format.js";

export const cx = (...a) => a.filter(Boolean).join(" ");

/* ------------------------------------------------------------------ buttons -- */
const VARIANT = {
  primary: "bg-ink text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-ink-2",
  nova: "bg-nova-fill text-white shadow-glow-nova hover:bg-nova-deep",        // one "start" per screen
  secondary: "bg-satin-2 text-ink hover:bg-line",
  ghost: "bg-transparent text-ink-2 hover:bg-satin-2 hover:text-ink",
  danger: "bg-bad-soft text-bad-ink hover:bg-bad-hover",
  white: "bg-white text-ink shadow-chip hover:bg-satin",
};
const SIZE = { sm: "h-9 gap-1.5 px-4 text-[13px]", md: "h-11 gap-2 px-5 text-sm" };
const ICON = { sm: 16, md: 18 };

/** Pill button. Always name the variant. `busy` disables it and the caller swaps the label. */
export const Button = forwardRef(function Button(
  { variant, size = "md", icon: Icon, iconRight: IconRight, busy, className, children, type = "button", disabled, ...rest }, ref) {
  return (
    <button ref={ref} type={type} {...rest} disabled={disabled || busy} aria-busy={busy || undefined}
      className={cx("inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-pill font-semibold",
        "transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.97]",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
        VARIANT[variant || "secondary"], SIZE[size], className)}>
      {Icon && <Icon size={ICON[size]} strokeWidth={2} aria-hidden />}
      {children}
      {IconRight && <IconRight size={ICON[size]} strokeWidth={2} aria-hidden />}
    </button>
  );
});

const IB_VARIANT = {
  white: "bg-white text-ink shadow-chip hover:bg-satin",
  satin: "bg-satin-2 text-ink hover:bg-line",
  ink: "bg-ink text-white hover:bg-ink-2",
  ghost: "text-ink-3 hover:bg-satin-2 hover:text-ink",
};
/** Round icon button. `label` is required: it becomes the aria-label and the hover title. */
export const IconButton = forwardRef(function IconButton({ label, icon: Icon, variant = "white", size = "md", className, ...rest }, ref) {
  return (
    <button ref={ref} type="button" aria-label={label} title={label} {...rest}
      className={cx("inline-flex shrink-0 items-center justify-center rounded-pill transition-[background-color,color,transform] duration-150",
        "active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
        size === "sm" ? "h-9 w-9" : "h-11 w-11", IB_VARIANT[variant], className)}>
      <Icon size={size === "sm" ? 18 : 20} strokeWidth={2} aria-hidden />
    </button>
  );
});

/** A white pill lifted by a shadow that turns ink when on. Never blue. */
export function Chip({ on, icon: Icon, className, children, role, ...rest }) {
  return (
    <button type="button" role={role} aria-pressed={role ? undefined : !!on} aria-checked={role === "radio" ? !!on : undefined} {...rest}
      className={cx("inline-flex h-9 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-pill px-4 text-[13px] font-semibold",
        "transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40",
        on ? "bg-ink text-white" : "bg-white text-ink-2 shadow-chip hover:text-ink", className)}>
      {Icon && <Icon size={15} strokeWidth={2} aria-hidden />}
      {children}
    </button>
  );
}

/** One choice out of a few (Day / Week / Month). `options` is [[value, label], …]. */
export function Choice({ label, value, options, onChange, className }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex flex-wrap gap-1.5", className)}>
      {options.map(([v, l]) => (
        <Chip key={v} role="radio" on={value === v} onClick={() => onChange(v)}>{l}</Chip>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- cards -- */
const PAD = { none: "", sm: "p-4", md: "p-5 sm:p-6", lg: "p-6 sm:p-8" };
/** White card on a soft shadow. Never put a Card inside a Card: group inside with Tiles. */
export const Card = forwardRef(function Card({ as: As = "section", padding = "md", hero, interactive, className, ...rest }, ref) {
  return (
    <As ref={ref} {...rest}
      className={cx("relative bg-white shadow-card", hero ? "rounded-hero" : "rounded-card", PAD[padding],
        interactive && "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float", className)} />
  );
});

/** Card heading: 15px bold title, an optional grey line under it, and controls on the right. */
export function CardTitle({ title, sub, right, className, as: As = "h2" }) {
  return (
    <div className={cx("mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <As className="text-[15px] font-bold tracking-[-0.01em] text-ink">{title}</As>
        {sub && <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/** Page heading row: title on the left, the page's few controls on the right. Scrolls with the page. */
export function PageHead({ title, sub, right, back, className }) {
  return (
    <div className={cx("mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0 basis-full sm:basis-auto">
        {back}
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-ink-3">{sub}</p>}
      </div>
      {right && <div className="flex flex-wrap items-end gap-x-3 gap-y-2">{right}</div>}
    </div>
  );
}

/** Small uppercase label over a hero number or a group. */
export const Eyebrow = ({ className, children }) => (
  <p className={cx("text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3", className)}>{children}</p>
);

/** A unit or denominator after a number: smaller, grey, normal tracking. */
export const Unit = ({ className, children }) => (
  <span className={cx("ml-1 text-[15px] font-medium tracking-normal text-ink-3", className)}>{children}</span>
);

const TONE_TEXT = { ink: "text-ink", ok: "text-ok-ink", warn: "text-warn-ink", bad: "text-bad-ink", nova: "text-nova-deep", muted: "text-ink-4" };

/** Value over label, in a satin tile inside a card. Wrap a group in <Tiles>. */
export function Tile({ label, value, note, tone, size = "md", className, title }) {
  return (
    <div className={cx("flex min-w-0 flex-col rounded-tile bg-satin", size === "sm" ? "px-3 py-2" : "px-4 py-3", className)} title={title}>
      <dt className="order-2 mt-0.5 truncate text-[11px] font-semibold text-ink-3">
        {label}{note && <span className="font-medium"> · {note}</span>}
      </dt>
      <dd className={cx("order-1 truncate font-bold tabular-nums tracking-[-0.01em]",
        size === "sm" ? "text-[15px] leading-6" : "text-[22px] leading-7", TONE_TEXT[tone] || "text-ink")}>
        {value == null || value === "" ? DASH : value}
      </dd>
    </div>
  );
}
export const Tiles = ({ className, children }) => <dl className={cx("grid gap-3", className)}>{children}</dl>;

/** A stat card: label on top, the value pushed to the bottom, an optional note.
 *  With `onClick` it is a button (pressing it ranks a list by this figure) and `active` rings it blue. */
export function Stat({ label, value, note, onClick, active, className, children }) {
  const body = (
    <>
      <p className="text-[13px] font-semibold text-ink-3">{label}</p>
      <div className="mt-auto pt-3">
        {value != null && <p className="text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">{value}</p>}
        {children}
        {note && <p className="mt-2 text-[13px] text-ink-3">{note}</p>}
      </div>
    </>
  );
  const cls = cx("relative flex min-h-[132px] flex-col rounded-card bg-white p-5 text-left shadow-card sm:p-6", className);
  if (!onClick) return <section className={cls}>{body}</section>;
  return (
    <button type="button" onClick={onClick} aria-pressed={!!active}
      className={cx(cls, "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float active:scale-[0.985]",
        active && "ring-2 ring-nova")}>
      {body}
    </button>
  );
}

/* ------------------------------------------------------------ badges & tags -- */
const TONE = {
  neutral: "bg-satin-2 text-ink-2",
  nova: "bg-nova-soft text-nova-deep",
  ok: "bg-ok-soft text-ok-ink",
  warn: "bg-warn-soft text-warn-ink",
  bad: "bg-bad-soft text-bad-ink",
  violet: "bg-violet-soft text-violet-ink",
};
/** Dense uppercase badge (11px). Show one only when it says something. */
export const Badge = forwardRef(function Badge({ tone = "neutral", className, children, ...rest }, ref) {
  return (
    <span ref={ref} {...rest} className={cx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-pill px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.05em]", TONE[tone], className)}>
      {children}
    </span>
  );
});
/** Sentence-case tag (13px), usually with a leading icon. */
export function Tag({ tone = "neutral", icon: Icon, className, children, ...rest }) {
  return (
    <span {...rest} className={cx("inline-flex max-w-full items-center gap-1.5 rounded-pill px-3 py-1 text-[13px] font-semibold", TONE[tone], className)}>
      {Icon && <Icon size={15} strokeWidth={2} aria-hidden className="shrink-0" />}
      {children}
    </span>
  );
}
/** The company dot: the only place a company hue appears outside charts. */
const CO = { Gainup: "bg-co-gainup", Technotek: "bg-co-technotek", Zenwear: "bg-co-zenwear" };
export const CompanyDot = ({ unit, className }) => (
  <span aria-hidden className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-pill", CO[unit] || "bg-ink-4", className)} />
);
/** Company hues for charts (same values as the old look). */
export const COMPANY_HEX = { Gainup: "#0e7490", Technotek: "#7c3aed", Zenwear: "#be1250" };

/* ------------------------------------------------------------------ fields -- */
export const fieldCls = cx("h-11 w-full min-w-0 rounded-pill bg-satin-2 px-4 text-sm text-ink placeholder:text-ink-3",
  "transition-[background-color,box-shadow] duration-150 hover:bg-line",
  "focus:bg-white focus:shadow-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-nova/40",
  "disabled:cursor-not-allowed disabled:text-ink-4");

/** Label above the control, always. `error` shows a red line under it. */
export function Field({ label, hint, error, className, children }) {
  const id = useId();
  const kids = React.Children.map(children, (c) => (React.isValidElement(c)
    ? React.cloneElement(c, { "aria-invalid": error ? true : undefined, "aria-describedby": error ? id + "-e" : hint ? id + "-h" : undefined })
    : c));
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-semibold text-ink-3">{label}</span>
      {kids}
      {hint && !error && <span id={id + "-h"} className="text-[13px] text-ink-3">{hint}</span>}
      {error && <span id={id + "-e"} role="alert" className="text-[13px] font-medium text-bad-ink">{error}</span>}
    </label>
  );
}
export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={cx(fieldCls, className)} />;
});
export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <span className="relative block min-w-0">
      <select ref={ref} {...rest} className={cx(fieldCls, "cursor-pointer appearance-none pr-10", className)}>{children}</select>
      <ChevronRight size={16} aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rotate-90 text-ink-3" />
    </span>
  );
});
/** Search with its own clear button. Pair it with `squash()` so case and spaces do not matter. */
export function Search({ value, onChange, label, placeholder, className }) {
  return (
    <div className={cx("relative min-w-0", className)}>
      <SearchIcon size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder={placeholder}
        className={cx(fieldCls, "pl-11 pr-11")} />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-pill text-ink-3 transition-colors hover:bg-line hover:text-ink">
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- progress, aura -- */
const BAR_H = { sm: "h-1.5", md: "h-2", lg: "h-3" };
const BAR_FILL = { ink: "bg-ink", nova: "bg-nova", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };
/** Track and fill. The first value is drawn at once; later changes slide (scaleX, never width).
 *  Values over the maximum are clipped on screen but announced. */
export function Progress({ value, max = 100, tone = "ink", size = "md", label, className }) {
  const fill = useRef(null), first = useRef(true);
  const ratio = Math.max(0, Math.min(1, max ? (+value || 0) / max : 0));
  useLayoutEffect(() => {
    if (!fill.current) return;
    if (first.current) { first.current = false; gsap.set(fill.current, { scaleX: ratio }); return; }
    motion.barTo(fill.current, ratio);
  }, [ratio]);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(+value || 0)}
      className={cx("w-full overflow-hidden rounded-pill bg-satin-2", BAR_H[size], className)}>
      <div ref={fill} className={cx("h-full w-full origin-left rounded-pill", BAR_FILL[tone])} />
    </div>
  );
}

const AURA = { nova: ["143,184,255", "47,123,245"], ok: ["134,239,172", "22,163,74"], warn: ["252,211,77", "245,158,11"], bad: ["252,165,165", "239,68,68"] };
/** The soft light behind the one thing that matters on a screen. Round, blurred, no sparkle.
 *  Place it with `className` (absolute); the content above it must be `relative`. */
export const Aura = forwardRef(function Aura({ tone = "nova", size = 360, intensity = 0.8, className, style }, ref) {
  const [core, deep] = AURA[tone] || AURA.nova;
  return (
    <div ref={ref} aria-hidden className={cx("pointer-events-none absolute rounded-full", className)}
      style={{ width: size, height: size, filter: "blur(18px)",
        background: `radial-gradient(closest-side, rgba(${core},${0.55 * intensity}) 0%, rgba(${deep},${0.22 * intensity}) 38%, rgba(${deep},0) 72%)`,
        ...style }} />
  );
});

/** Placeholder shaped like the real thing. The parent sets aria-busy. */
export const Skeleton = ({ className }) => <div aria-hidden className={cx("motion-only animate-pulse rounded-tile bg-satin-2", className)} />;

/* ------------------------------------------------------- empty, error, toast -- */
/** Nothing here: a quiet icon, what is missing, and the action that fills it. */
export function Empty({ icon: Icon, title, hint, action, className }) {
  return (
    <div className={cx("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon && (
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-pill bg-satin-2 text-ink-2">
          <Icon size={26} strokeWidth={2} aria-hidden />
        </span>
      )}
      <p className="text-[17px] font-bold tracking-[-0.01em] text-ink">{title}</p>
      {hint && <p className="mt-1.5 max-w-[340px] text-[13px] leading-relaxed text-ink-3">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** A problem while data is still on screen: a soft strip with Retry. */
export function Alert({ tone = "bad", children, onRetry, retryLabel = "Retry", className }) {
  return (
    <div role="alert" className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-tile px-4 py-3 text-[13px] font-medium", TONE[tone], className)}>
      <AlertCircle size={16} strokeWidth={2} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry && <Button variant="ghost" size="sm" icon={RotateCw} onClick={onRetry} className="-my-1">{retryLabel}</Button>}
    </div>
  );
}

/** One short message over the bottom bar. */
export function Toast({ msg }) {
  const ref = useRef(null);
  useLayoutEffect(() => { if (msg) motion.popIn(ref.current); }, [msg]);
  if (!msg) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-40 flex justify-center px-4">
      <div ref={ref} role="status" aria-live="polite"
        className="max-w-[min(520px,100%)] rounded-tile bg-ink px-5 py-3 text-sm font-semibold text-white shadow-float">
        {msg}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- disclosure -- */
/** A full-width group header that opens and closes the list under it: chevron disc, bold name,
 *  a one-line summary, and room on the right for a few badges. */
export function GroupHeader({ open, onToggle, title, lead, summary, right, controls }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={controls}
      className="flex w-full items-center gap-3 rounded-card bg-white px-4 py-4 text-left shadow-card transition-[transform,box-shadow] duration-200 hover:shadow-float active:scale-[0.99] sm:px-5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-satin-2 text-ink-2">
        <ChevronRight size={18} strokeWidth={2} aria-hidden className={cx("transition-transform duration-200", open && "rotate-90")} />
      </span>
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-bold tracking-[-0.01em] text-ink">{title}</span>
        {summary && <span className="mt-0.5 block truncate text-[13px] text-ink-3">{summary}</span>}
      </span>
      {right && <span className="hidden shrink-0 items-center gap-1.5 sm:flex">{right}</span>}
    </button>
  );
}

/* ----------------------------------------------------------- centred card -- */
/** Desk detail: a small card centred on the page over a light blur. Escape or the backdrop closes it;
 *  focus moves into it and goes back where it was on close. */
export function CentreCard({ open, title, sub, onClose, children, footer, width = 440 }) {
  const card = useRef(null), backdrop = useRef(null), closeBtn = useRef(null), back = useRef(null);
  const titleId = useId();
  useLayoutEffect(() => {
    if (!open) return;
    back.current = document.activeElement;
    motion.centreIn(card.current, backdrop.current);
    if (closeBtn.current) closeBtn.current.focus({ preventScroll: true });
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (back.current && back.current.focus) back.current.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div ref={backdrop} className="absolute inset-0 bg-ink/20 backdrop-blur-sm" onClick={onClose} />
      <div ref={card} className="relative flex max-h-[min(640px,86vh)] w-full flex-col rounded-hero bg-white shadow-float" style={{ maxWidth: width }}>
        <div className="flex items-start gap-3 px-6 pb-3 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-xl font-bold tracking-[-0.01em] text-ink">{title}</h2>
            {sub && <p className="mt-0.5 text-sm text-ink-3">{sub}</p>}
          </div>
          <IconButton ref={closeBtn} label="Close" icon={X} variant="satin" size="sm" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-line px-6 pb-5 pt-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------- money worked out two ways -- */
/* Every money figure is shown both ways, side by side, never behind a switch (Akhil, 2026-09-30):
   by km (diesel priced on the km the bus travelled) and by diesel (what the ERP actually issued).
   A diesel figure that has not loaded reads "—", never ₹0. */

/** Two figures of equal weight, each with its small grey label under it. */
export function BothFigures({ km, diesel, fmt, size = "md", className }) {
  const big = size === "lg" ? "text-[28px] tracking-[-0.02em]" : size === "sm" ? "text-[15px]" : "text-[22px] tracking-[-0.01em]";
  const one = (v, label) => (
    <div className="min-w-0">
      <dd className={cx("truncate font-bold leading-none tabular-nums text-ink", big)}>{v == null ? DASH : fmt(v)}</dd>
      <dt className="mt-1.5 text-[11px] font-semibold text-ink-3">{label}</dt>
    </div>
  );
  return (
    <dl className={cx("flex flex-wrap items-end gap-x-6 gap-y-3", className)}>
      {one(km, "by km")}
      {one(diesel, "by diesel")}
    </dl>
  );
}
/** The same pair inline: "₹37 by km · ₹54 by diesel". */
export function BothInline({ km, diesel, fmt, className }) {
  return (
    <span className={cx("tabular-nums", className)}>
      <b className="font-bold text-ink">{km == null ? DASH : fmt(km)}</b><span className="text-ink-3"> by km · </span>
      <b className="font-bold text-ink">{diesel == null ? DASH : fmt(diesel)}</b><span className="text-ink-3"> by diesel</span>
    </span>
  );
}

/* ------------------------------------------------------------------- motion -- */
/** Rise the marked children of `ref` once `ready` turns true (data landed, not mount). */
export function useRise(ref, ready, deps = [], stagger = 60) {
  useEffect(() => {
    if (!ready || !ref.current) return;
    const els = ref.current.querySelectorAll(":scope > [data-rise], [data-rise-deep]");
    const tw = motion.rise(els, stagger);
    return () => { if (tw) tw.progress(1).kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ...deps]);
}

/* -------------------------------------------------------------------- tables -- */
/* Tables are for logs and side-by-side comparisons only; things people act on are cards.
   Zebra rows with rounded ends, no rules, a plain grey header. On a phone the table scrolls
   sideways inside its card, never the page. Use thCls / tdCls on cells; numbers get "text-right
   tabular-nums", vehicle numbers, codes and times "font-code". */
export function DataTable({ className, children, label }) {
  return (
    <div className={cx("relative -mx-1 overflow-x-auto", className)} role="region" aria-label={label} tabIndex={label ? 0 : undefined}>
      <table className="w-full border-separate border-spacing-0 text-[13px] text-ink">{children}</table>
    </div>
  );
}
export const thCls = "whitespace-nowrap px-3 pb-2 pt-1 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-ink-3 first:pl-4 last:pr-4";
export const trCls = "even:bg-satin/70";
export const tdCls = "px-3 py-2.5 align-middle first:rounded-l-[14px] first:pl-4 last:rounded-r-[14px] last:pr-4";
