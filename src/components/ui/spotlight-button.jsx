/* ============================================================================
 * components/ui/spotlight-button.jsx — primary nav
 * ----------------------------------------------------------------------------
 * The header's four destinations. Each item is icon + label; the active one gets
 * an underline indicator that measures real item widths (so labels of any length
 * stay aligned) and a soft light cone rising off it.
 * ==========================================================================*/
import React, { useState, useRef, useEffect } from 'react';

const NavItem = ({ icon: Icon, label, isActive = false, onClick, indicatorPosition, itemRef, t }) => {
  // only the selected tab is lit — the original demo bled the cone onto neighbours by
  // distance, which read as a stray glow on tabs that weren't selected
  const spotlightOpacity = indicatorPosition < 0 || !isActive ? 0 : 1;

  return (
    <button
      ref={itemRef}
      data-fx="tab"
      title={label}
      aria-current={isActive ? 'page' : undefined}
      className="relative flex items-center justify-center gap-2 h-12 px-3 lg:px-3.5 transition-colors duration-200"
      style={{ color: isActive ? t.primary : t.muted }}
      onClick={onClick}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = t.text; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = t.muted; }}
    >
      {/* brand-tinted light rising off the indicator. The source sits just below the button so
          the falloff is a cone, not a dome, and a vertical mask kills it well before the top
          edge — otherwise the gradient stops mid-air and reads as a hard-edged blob. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-full transition-opacity duration-300 pointer-events-none"
        style={{
          background: `radial-gradient(52% 82% at 50% 106%, ${t.primary}30 0%, ${t.primary}17 38%, ${t.primary}08 60%, transparent 82%)`,
          maskImage: 'linear-gradient(to top, #000 0%, #000 22%, transparent 88%)',
          WebkitMaskImage: 'linear-gradient(to top, #000 0%, #000 22%, transparent 88%)',
          opacity: spotlightOpacity,
          transitionDelay: isActive ? '0.1s' : '0s',
        }}
      />
      <Icon size={17} strokeWidth={isActive ? 2.5 : 2} className="relative shrink-0" />
      {/* label is the destination; the icon only speeds up re-finding it. Below lg the four
          labels plus the brand and the ERP pill stop fitting on one row, so the bar falls back
          to icons and the name is carried for assistive tech only. */}
      <span className="relative hidden lg:block text-sm font-semibold whitespace-nowrap">{label}</span>
      <span className="sr-only lg:hidden">{label}</span>
    </button>
  );
};

/** Reusable spotlight nav — items: [{ key, label, icon }]. Themed to the app surface;
 *  the indicator measures real item widths so labels of any length stay aligned. */
export function SpotlightNav({ items, activeKey, onChange, t, className = '' }) {
  const activeIndex = items.findIndex((i) => i.key === activeKey);
  const navRef = useRef(null);
  const itemRefs = useRef([]);
  const [bar, setBar] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const measure = () => {
      const el = itemRefs.current[activeIndex], nav = navRef.current;
      if (!el || !nav) return;
      const a = el.getBoundingClientRect(), b = nav.getBoundingClientRect();
      setBar({ left: a.left - b.left, width: a.width });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeIndex, items.length]);

  return (
    <nav ref={navRef} aria-label="Primary" className={`relative flex items-center ${className}`}>
      {/* sliding brand indicator, sitting on the header's bottom edge like the original tabs */}
      <div
        aria-hidden
        className="absolute bottom-0 h-[2px] rounded-full transition-all duration-300 ease-out"
        style={{
          left: bar.left, width: bar.width, opacity: activeIndex < 0 ? 0 : 1,
          // fades out at both ends so the underline melts into the header rather than stopping dead
          background: `linear-gradient(90deg, transparent, ${t.primary} 18%, ${t.primary} 82%, transparent)`,
        }}
      />
      {items.map((item, index) => (
        <NavItem
          key={item.key}
          t={t}
          itemRef={(el) => (itemRefs.current[index] = el)}
          icon={item.icon}
          label={item.label}
          isActive={activeIndex === index}
          onClick={() => onChange(item.key)}
          indicatorPosition={activeIndex}
        />
      ))}
    </nav>
  );
}

export { NavItem };
