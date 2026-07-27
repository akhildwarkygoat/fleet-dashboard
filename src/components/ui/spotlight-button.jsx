/* ============================================================================
 * components/ui/spotlight-button.jsx — spotlight nav (JSX port)
 * ----------------------------------------------------------------------------
 * shadcn-style UI primitive. A dark glass nav bar where the active item gets a
 * top light-bar and a soft spotlight falling onto its icon; the indicator and
 * spotlight slide as the selection moves. Adapted from the source demo into a
 * reusable, prop-driven component (items/activeKey/onChange) for the header.
 * Geometry: w-10 buttons + mx-2 → 56px pitch; px-2 bar padding → 16px offset.
 * ==========================================================================*/
import React, { useState, useRef, useEffect } from 'react';
import { Home, Bookmark, PlusCircle, User, Settings } from 'lucide-react';

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
      aria-label={label}
      className="relative flex items-center justify-center w-12 h-12 transition-colors duration-200"
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
      <Icon size={19} strokeWidth={isActive ? 2.5 : 2} className="relative" />
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

/* Fallback palette so the demo renders standalone (the app always passes its own theme `t`). */
const DEMO_THEME = { primary: '#4f46e5', text: '#0f172a', muted: '#64748b' };

/** Source demo, kept for reference/reuse (self-contained, fixed items). */
export const Component = () => {
  const [activeKey, setActiveKey] = useState('home');
  const navItems = [
    { key: 'home', label: 'Home', icon: Home },
    { key: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
    { key: 'add', label: 'Add', icon: PlusCircle },
    { key: 'profile', label: 'Profile', icon: User },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];
  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <SpotlightNav t={DEMO_THEME} items={navItems} activeKey={activeKey} onChange={setActiveKey} />
    </div>
  );
};

export { NavItem };
