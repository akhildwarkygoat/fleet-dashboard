# Fleet Dashboard — UI Design System

Extracted from the running app on 2026-08-27. This is a description of what the
dashboard **already does** at its best, written down so every tab can be held to it.
Where the app currently contradicts itself, the contradiction is recorded as a
**Drift** with the resolution that was applied.

## 1. Source Of Truth

- **Reference implementation:** [src/Dashboard.jsx](../src/Dashboard.jsx) — the `UI PRIMITIVES`
  block at [src/Dashboard.jsx:505](../src/Dashboard.jsx:505). It is the most complete set
  (13 primitives vs. 8 in the copies), the only one wired into the motion system, and the
  only one whose button colours are contrast-checked.
- **Reference routes:** `Live` (app entry, `tab === "live"`), `Settings` (renders without data).
- **Viewport evidence:** Settings and Optimiser captured at 800×450 in the light theme.
  `Live`, `Cost report` and `Compare` are gated behind the ERP feed, which did not return
  in this environment — they are covered by code reading only. See §10.
- **Theme source:** `THEMES` at [src/Dashboard.jsx:89](../src/Dashboard.jsx:89) — three themes
  (`light`, `dark`, `neutral`), one shared token vocabulary.

**Styling system:** Tailwind v3 for *layout and metrics only* (`tailwind.config.js` extends
nothing). Every colour comes from the `t` theme object passed down as a prop and applied via
inline `style`. There is no CSS-in-JS, no component library, no Tailwind colour classes.

> **Rule:** never write a Tailwind colour class (`bg-slate-800`, `text-gray-500`). Colour
> comes from `t`. Tailwind supplies `rounded-*`, `px-*`, `text-sm`, `flex`, `grid` only.
> The sole exceptions are `bg-white` on the `Switch` knob and the fixed route `PALETTE`,
> both of which are deliberately theme-independent.

## 2. Product Feel

A dense operations console read at a desk, not a marketing page. Concretely:

- **Information first.** Decoration only ever encodes a value. The accent rail on a `Tile`
  renders *only* when the caller passes a colour derived from the data — a coloured tile
  always means something.
- **Calm surfaces, loud status.** Neutral greys carry the layout; `good`/`watch`/`poor` are
  the only saturated colours in the chrome.
- **Motion confirms, never announces.** Everything moves on a spring, transform+opacity only.
  Returning to a seen tab uses the short `snap` path, not the full stagger.
- **Numbers are typographic objects.** Every figure is `tabular-nums` so columns of digits
  line up and don't jitter while `CountUp` tweens them.

## 3. Visual Tokens

All defined in `THEMES` at [src/Dashboard.jsx:89](../src/Dashboard.jsx:89).

### Colour roles

| Token | Role | light | dark | neutral |
| --- | --- | --- | --- | --- |
| `bg` | app canvas | `#eef2f7` | `#1a222c` | `#eceff3` |
| `surface` | card / tile / modal | `#ffffff` | `#222e3a` | `#ffffff` |
| `surface2` | inset wells, segmented track | `#f8fafc` | `#2b3846` | `#f5f7fa` |
| `raised` | hover + active fills, tooltips | `#f1f5f9` | `#374553` | `#e4e7eb` |
| `border` | every 1px divider | `#e2e8f0` | `#3a4a59` | `#cbd2d9` |
| `text` | primary copy | `#0f172a` | `#f5f7fa` | `#1f2933` |
| `muted` | labels, hints, inactive | `#556070` | `#9aa5b1` | `#616e7c` |
| `faint` | tertiary / disabled | `#94a3b8` | `#616e7c` | `#9aa5b1` |
| `primary` | focus ring, links, accents | `#2186eb` | `#2186eb` | `#3d6b99` |
| `primaryStrong` | **filled button/pill background** | `#1c74cf` | `#1c74cf` | `#2f5679` |
| `inputBg` | field interiors | `#f8fafc` | `#151d26` | `#f5f7fa` |
| `good` / `watch` / `poor` | status | `#047857` / `#b45309` / `#be123c` | `#3ebd93` / `#f7d070` / `#f87171` | `#0f7a5f` / `#8d6a1a` / `#ba2525` |
| `gainup` / `techno` / `zenwear` | company identity | `#0e7490` / `#7c3aed` / `#be1250` | `#2cb1bc` / `#8888fc` / `#f2648c` | `#146b7d` / `#4c63b6` / `#a8325a` |

**`primary` vs `primaryStrong` is a contrast rule, not a shade preference.** Filled controls
carry 12–14px white text; `primary` (`#2186eb`) reaches only 3.7:1 there and fails WCAG AA.
`primaryStrong` reaches 4.72:1.

> **Rule:** any control that fills its background with the brand colour and puts text on top
> uses `t.primaryStrong || t.primary` with `t.onPrimary`. `t.primary` is for strokes, focus
> rings, icons and text *on* a neutral surface — never as a fill behind small white text.

`*Soft` variants (`primarySoft`, `goodSoft`, `watchSoft`, `poorSoft`) are the translucent
tint used behind pills, so the pill picks up whatever surface is beneath it.

### Materials & depth

Floating chrome is a **material**, not a strip of background colour: content passes *under*
it, so the page reads as one continuous surface with a layer above it. The header is the only
material surface in the app.

| Token | Role | Value |
| --- | --- | --- |
| `--chrome-bg` | the material itself | `t.surface` at **0.80** alpha |
| `--chrome-solid` | opaque fallback | `t.surface` |
| `--chrome-sheen` | light catching the top lip | white at `.06` dark / `.7` light |
| `--chrome-edge` | scroll-edge divider | `t.border` |
| `--chrome-shadow` | separation once content is beneath | black `.35` dark / slate `.07` light |

Blur is `blur(20px) saturate(180%)`. Alpha is 0.80 rather than the ~0.65 that reads as
"obviously glass": a **larger surface should read as a thicker material**, and at a thinner
mix the coloured timeline chips scrolling underneath competed with the nav labels.

**Scroll edge effect, not a permanent hairline.** The divider under the header is transparent
at rest and fades in only while content is actually passing beneath it (`data-scrolled` on
`.app-chrome`, driven by an rAF-throttled passive scroll listener). A hairline that is always
drawn separates the chrome from a page that isn't there yet.

**Dim to focus.** A blocking task pairs its surface with a scrim (`.fx-scrim`,
`blur(12px) saturate(120%)`) that pushes the page back. The blur radius is *fixed* and the
layer is composited in from zero opacity, so the material appears to arrive without
re-blurring the whole viewport at a new radius every frame — which is the expensive way to
do it and would jank on the floor machines.

### Typography

Single family: **Inter Variable**, self-hosted from `public/fonts` (see the comment at the
top of [src/index.css](../src/index.css) — the factory-floor launcher may have no npm route,
so the font must not need installing). Stack:
`'Inter Variable', Inter, system-ui, sans-serif`.

**Tracking is size-specific — one `letter-spacing` for every size is wrong somewhere.** Text
reads too loose as it grows, so large text tightens; small and uppercase text needs the extra
air to stay legible. Two helper classes carry this: `.type-display` (−0.025em, leading 1.1)
and `.type-metric` (−0.02em, leading 1.05, tabular figures).

| Use | Spec | Tailwind |
| --- | --- | --- |
| Page title | 24px / bold / −0.025em | `text-2xl font-bold type-display` |
| Tile value | 30px / bold / tabular / −0.02em | `text-3xl font-bold tabular-nums type-metric` |
| Card title | 14px / semibold / uppercase / wide | `font-semibold tracking-wide uppercase text-sm` |
| Tile label | 12px / uppercase / widest | `text-xs uppercase tracking-widest` |
| Body + controls | 14px | `text-sm` |
| Hint / sub / meta | 12px | `text-xs` |
| Field label | 12px `muted`, or 13px/600 `text` when `strong` | — |
| Dense table chrome | 10px | `text-[10px]` |

### Radius scale

`rounded-sm` (2px) · `rounded-lg` (8px) · `rounded-xl` (12px) · `rounded-2xl` (16px) · `rounded-full`

| Radius | Applies to |
| --- | --- |
| `rounded-2xl` | Card, Tile, Modal — every top-level container |
| `rounded-xl` | Buttons, inputs, selects, segmented track |
| `rounded-lg` | Nested chrome inside a card: icon buttons, tooltips, table cells |
| `rounded-full` | Pills, switches, dots, segmented thumb |
| `rounded-sm` | 8px unit dots and legend swatches |

> **Rule:** `rounded-md` (6px) is **not** in the scale. It reads as a slightly-wrong `lg`.

### Spacing & metrics

- Card padding `p-5` with header `px-5 pt-4 pb-1`, body `p-5 pt-3`.
- Tile padding `p-4`. Accent rail `w-1`, full height, left edge.
- Button `px-4 py-2.5`; inputs `px-3 py-2.5`; pills `px-2.5 py-1`.
- Segmented: track `p-1`, thumb `px-4 py-1.5` (`px-3 py-1` when `small`).
- Grid gap `gap-4`; section rhythm `mb-5`.
- Borders are always exactly `1px solid t.border`.

## 4. Motion — springs, not curves

Defined in [src/ui/motion.js](../src/ui/motion.js). GSAP, transform + opacity only.

Every easing in the app is a **real spring**, sampled from the analytic step response of a
second-order system — not a hand-picked bezier. The reason is Apple's (WWDC 2018, *Designing
Fluid Interfaces*): a fixed-duration curve has already decided how it will end, so it cannot
respond to new input. A spring has no fixed duration — its settle time falls out of the
physics, and a new target just changes where it is heading. Anything a user can touch
should move on one.

Two designer-facing parameters, not the physics triplet:

- **damping** — `1.0` is critically damped and settles with no overshoot; `< 1.0` overshoots.
- **response** — how quickly it reaches the target, in seconds. *Not* a duration.

| Spring | damping | response | settle | overshoot | Used for |
| --- | --- | --- | --- | --- | --- |
| `move` | `1.0` | `0.4` | 0.592s | 0% | The default. Repositioning, page entrances, hover lift. |
| `rotate` | `0.8` | `0.4` | 0.542s | 1.52% | Rotation, button press, the logo mark. |
| `drawer` | `0.8` | `0.3` | 0.408s | 1.52% | Sheets, modals, popovers, `Reveal`, segmented thumb. |
| `snap` | `1.0` | `0.28` | 0.412s | 0% | Small frequent changes; reversible transitions. |

Overshoot is verified against the closed form `e^(−πζ/√(1−ζ²))` — `rotate` and `drawer`
hit 1.52% to two decimal places.

> **Rule:** add bounce only when the gesture itself carried momentum. Overshoot on a menu
> that merely faded in feels wrong; on something flicked or pressed it feels right. That is
> why `move` — the default — is critically damped, and why reversible transitions use `snap`:
> an overshooting curve run backwards dips *past* the closed state on the way out.

**CSS gets the same curves.** `springTween(name)` spreads into a GSAP tween; the identical
springs are also sampled into CSS `linear()` easings and published as custom properties on
the root element at module load:

```css
transition: transform var(--dur-spring-drawer) var(--ease-spring-drawer);
```

`--ease-spring-{move,rotate,drawer,snap}` and `--dur-spring-*`. Browsers without `linear()`
discard the declaration and fall back to the preceding one, so always write a plain fallback
first. This is what keeps CSS transitions and GSAP tweens one motion vocabulary rather than
two that merely resemble each other.

| Name | Trigger | Spec |
| --- | --- | --- |
| `fxPress` | `onMouseDown` of any button | scale 0.96 → 1 on `rotate` |
| `fxLift` / `fxDrop` | hover enter/leave of a selectable card | y −3 / scale 1.02 on `move` |
| CSS `:active` | any button GSAP does not own | scale 0.97 on `snap` |
| Page entrance | tab change, first visit | title → tiles → cards → swatches → bus grid, on `move` |
| Page re-entrance | tab change, seen before | short `snap` fade of title/tiles/cards only |
| Modal | mount | scrim composites in on `move`; card y24 + scale 0.96 on `drawer` |
| Theme switch | `.theme-switching` for ~0.5s | 0.4s colour crossfade, transforms excluded |

**Response is the foundation.** Press feedback fires on pointer-**down**, never on release —
the moment feedback waits for touch-up, directness falls off a cliff. The CSS `:active` rule
is the floor for every button GSAP does not already own; GSAP's inline transform wins where
it does.

### Momentum

Two helpers exist for gesture work, both from Apple's sample code:

- `project(velocity, deceleration = 0.998)` — where a flick would come to rest. Snap to the
  target nearest the **projected** point, not the one nearest where the finger let go. Note
  this is exponential decay, **not** the textbook `v²/(2a)`.
- `rubberband(overshoot, dimension, constant = 0.55)` — progressive resistance past a
  boundary. A hard stop reads as frozen; resistance reads as "responsive, but there is
  nothing more here."

**Two hard guards, both mandatory:**

1. `prefersReduced()` — every micro-interaction returns early, and `springTween()` collapses
   to a 0.15s non-overshooting tween.
2. `canEntrance()` — an entrance `from()` tween must not run while the tab is backgrounded.
   rAF is paused there, so the tween would hide content and never reveal it. The page
   timeline also wipes stale hidden state via `clearProps` on the non-entrance path.

### The `data-fx` contract

The page-entrance timeline at [src/Dashboard.jsx:2580](../src/Dashboard.jsx:2580) selects
purely on `data-fx` attributes, scoped to `mainRef`:

`page-title` → `tile` → `card` → `swatch` → `bus`

> **Rule:** a container that is visually a card or a tile **must** carry
> `data-fx="card"` / `data-fx="tile"`. This is not decorative bookkeeping — it is the only
> thing that makes a tab animate. A primitive that omits it silently opts its whole tab out
> of the app's motion.

## 5. Component Specs

### Card
`rounded-2xl` + 1px border on `t.surface`, `data-fx="card"`. Optional header row
(`title` uppercase, `hint` 12px muted, `right` slot), body `p-5 pt-3`.
**No card nests inside another card** — use a bordered well on `t.surface2` instead.

### Btn
`inline-flex items-center gap-2 rounded-xl font-semibold px-4 py-2.5 text-sm transition-colors`,
`fxPress` on mousedown, `disabled:opacity-50 disabled:cursor-not-allowed`.

| variant | fill | text | border |
| --- | --- | --- | --- |
| `primary` | `t.primaryStrong \|\| t.primary` | `t.onPrimary` | none |
| `ghost` (default other) | transparent | `t.text` | `1px t.border` |
| `danger` | transparent | `t.poor` | `1px t.poor` |

### Tile
`rounded-2xl` bordered, `data-fx="tile"`, `p-4`. Label 12px uppercase widest muted; value
30px bold tabular via `CountUp`; optional `sub` line tinted by `deltaColor`.
Accent rail renders **only** when `accent` is passed.

### Pill / StatusPill
`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider`, colour `c` on
`cSoft`. **Always pairs colour with a second channel** — an icon (`Pill`) or a dot
(`StatusPill`) — so status survives colour-vision deficiency.

### Inputs
`w-full rounded-xl px-3 py-2.5 text-sm outline-none`, `t.inputBg` on 1px `t.border`.
Border recolours to `t.primary` on focus. `outline-none` is safe **only** because
`*:focus-visible` in [src/index.css](../src/index.css) restores a 2px `var(--focus-ring)`
ring for keyboard users.

### Segmented
Track: `rounded-full`, `t.surface2`, 1px border, `p-1`, inset shadow.
Thumb: `rounded-full`, `px-4 py-1.5` (`px-3 py-1` small), 0.18s transition, `translateY(-0.5px)` when active.

- **Active:** filled with the option's colour when supplied, else `t.primaryStrong`.
- **Text on the thumb:** picked by relative luminance — white or `#0f172a`, whichever
  contrasts better. Verified ≥ 4.72:1 for every option colour in all three themes.
- **Inactive:** `t.muted` on transparent; hover → `t.text` on `t.raised`.

Options are `[value, label]` or `[value, label, colour]`. The third element is a live
information channel — company filters colour the thumb per company via `unitColor()`.

### Empty
Always inside a `Card`. Centred, `py-10`, 20px semibold title + 14px muted sub, optional
action slot beneath.

### Modal
Centred over a `.fx-scrim` (`rgba(0,0,0,.45)` + `blur(12px)`), `max-w-md`, `rounded-2xl`,
header row with a `rounded-lg` bordered close button. Backdrop click closes, `Escape` closes,
content click stops propagation — a modal you can only leave with the mouse is a trap.
Carries `role="dialog"` + `aria-modal`. The scrim composites in on `move` while the card
springs up on `drawer`, so the surface reads as a material arriving rather than a rectangle
whose opacity went up.

## 6. Implementation Map

| Rule | Encoded in |
| --- | --- |
| Theme tokens | `THEMES`, [src/Dashboard.jsx:89](../src/Dashboard.jsx:89) |
| Springs, guards, momentum helpers | [src/ui/motion.js](../src/ui/motion.js) |
| Materials, type classes, a11y media queries | [src/index.css](../src/index.css) |
| **Shared primitives** | [src/ui/kit.jsx](../src/ui/kit.jsx) |
| Optimiser re-export shim | [src/optimiser/ui.jsx](../src/optimiser/ui.jsx) |
| Focus ring, scrollbars, fonts | [src/index.css](../src/index.css) |
| Route colour palette | `PALETTE` in [src/ui/kit.jsx](../src/ui/kit.jsx) |
| Top nav | [src/components/ui/spotlight-button.jsx](../src/components/ui/spotlight-button.jsx) |

**Tabs:** `live` · `optimiser` · `costs` · `compare` · `settings`, plus `bus` as a
drill-down from `live`. Declared as `TABS` at [src/Dashboard.jsx:2883](../src/Dashboard.jsx:2883).

## 7. Drift Found And Resolved

The app had **four independent copies** of the same primitives. `Card` and the inputs had
stayed in step; everything else had diverged.

| # | Drift | Effect | Resolution |
| --- | --- | --- | --- |
| 1 | `optimiser/ui.jsx` `Card`/`Tile` omitted `data-fx` | **Optimiser was the only tab with no entrance animation** | Single `Card`/`Tile` in the kit, always tagged |
| 2 | `optimiser`/`stops` `Btn` had no `fxPress` | Buttons felt dead on the Optimiser tab, alive elsewhere | One `Btn` |
| 3 | `stops/ui.jsx` `Btn` used `t.primary` + hardcoded `#fff` | Different blue, **3.7:1 — fails WCAG AA** | One `Btn` on `primaryStrong`/`onPrimary` |
| 4 | Two unrelated `Segmented` designs | Dashboard: inset underline. Optimiser: filled pill. Same app. | Merged — see §5 |
| 5 | `optimiser` `Tile` had no `CountUp` | Optimiser numbers snapped, others tweened | One `Tile` |
| 6 | `Field` `strong` existed only in Dashboard | Money/formula labels lost weight in other modules | One `Field` |
| 7 | `stops` `Empty` was not wrapped in a `Card` | Bare unstyled text | One `Empty` |
| 8 | Two `StatusPill`s, different casing + fallback | `no-gps` vs `ok` on unknown status | One `StatusPill`, `no-gps` fallback |
| 9 | `Btn` used `transition` (all properties) outside Dashboard | Transitioned transform, fighting GSAP `fxPress` | `transition-colors` everywhere |
| 10 | 8 × `rounded-md` in optimiser | Off-scale radius | → `rounded-lg` |
| 11 | `efficiency/` `Tile` rail was `accent \|\| t.primary` | Rail always drawn — broke the "colour means something" rule | Documented; module is dead code (§10) |
| 12 | `ErpLoading` "Try again" was a raw `<button>` at `py-2` | Off-metric and no press feedback, on the app's most-seen error | → `<Btn>` |

## 8. Interaction Grammar

| State | Treatment |
| --- | --- |
| Hover (button) | `transition-colors`, ≤ 0.18s |
| Hover (selectable card) | `fxLift` — y −3, scale 1.02 |
| Hover (row) | `.fx-row-hover`, 0.12s background |
| Pressed | `fxPress` elastic |
| Focus-visible | 2px `var(--focus-ring)` @ 2px offset; offset 0 on fields |
| Selected | Filled `primaryStrong` (or option colour) + luminance-picked text |
| Disabled | `opacity-50` + `cursor-not-allowed` |
| Loading | Branded overlay — `RouteBusLoader` / `ErpLoading` with phase + progress |
| Empty | `Empty` in a Card, with an action when one exists |
| Error | `phase === "error"` → offline copy + **Try again** |

### Accessibility preferences

Three independent OS signals, all honoured. Reduced motion does **not** mean no feedback — it
means a gentler, non-vestibular equivalent.

| Signal | Response |
| --- | --- |
| `prefers-reduced-motion: reduce` | `springTween()` collapses to a 0.15s non-overshooting tween; entrances skip entirely (with `clearProps` so nothing is left hidden); the CSS `:active` scale becomes a colour transition. |
| `prefers-reduced-transparency: reduce` | Chrome and scrim go opaque, blur dropped, divider drawn permanently. Leaflet's glass controls go solid too. |
| `prefers-contrast: more` | Chrome goes opaque behind a `currentColor` border; focus ring widens to 3px. |

All three were verified present in the CSSOM at runtime, not just written.

## 9. Responsive

Tailwind defaults; the app uses `sm` / `md` / `lg` / `xl` only. Desktop-first — this runs
on factory-floor desktops. Tiles `grid-cols-2 lg:grid-cols-4`; nav wraps; wide tables scroll
inside `overflow-x-auto` rather than widening the page.

## 10. Open Decisions

1. **`src/stops/` and `src/efficiency/` are not imported anywhere** — they are dead code and
   Vite never bundles them. Left untouched. They should be deleted or re-mounted; keeping
   unreferenced UI copies is what let the drift in §7 accumulate unnoticed.
2. **`Live` / `Cost report` / `Compare` were not visually verified** — all three are gated on
   the ERP feed, which authenticated but did not return data in this environment. They share
   the refactored primitives, so they are covered structurally, but a screenshot pass on the
   factory network is still worth doing.
3. **`Btn` has no `sm` size.** Callers hand-roll small buttons with raw `<button>` (71
   occurrences across the optimiser). A `size` prop would absorb most of them — deliberately
   out of scope here, as it means touching call sites rather than the shared surface.
4. **Two `Empty` shapes remain by design** — with and without an action slot. Unified into one
   optional `children` slot; no caller needs to change.
5. **The Optimiser tab has no page title.** `titleMap.optimiser` is `""`
   ([src/Dashboard.jsx:2734](../src/Dashboard.jsx:2734)) because it renders its own
   service-picker header and breadcrumb bar. Judged a legitimately different workflow —
   a full-bleed planning workspace, not a report page — and left alone. The cost is that
   `data-fx="page-title"` never matches there, so its entrance starts at the tiles.
6. **Accordion panels in `OptimiseView` sit on `t.surface` inside a `t.surface` Card**
   ([src/optimiser/OptimiserTab.jsx:680](../src/optimiser/OptimiserTab.jsx:680)). Formally
   card-in-card, but the header strip is `t.surface2`, so the boundary does read. Left as
   is rather than restyled blind — this view is ERP-gated and could not be seen. Worth a
   look on the factory network.
