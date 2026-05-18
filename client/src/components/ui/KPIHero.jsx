import React from 'react';

/**
 * Hero KPI tile — one per dashboard.
 * Indigo gradient background, glow blob, 44px gradient-text number, decorative sparkline.
 *
 * Props:
 *   label  – eyebrow label (uppercase)
 *   value  – number, required
 *   icon   – React element (Lucide icon at size 14)
 */
const KPIHero = ({ label, value, icon }) => {
  const n = Number(value) || 0;
  const formatted = `${n < 0 ? '−' : ''}₪${Math.abs(n).toLocaleString()}`;

  return (
    <div style={{
      position: 'relative',
      borderRadius: 'var(--r-20)',
      padding: 'var(--s-24)',
      background: [
        'linear-gradient(135deg, rgba(124,92,255,0.18) 0%, rgba(85,56,224,0.05) 60%, rgba(20,23,33,0) 100%)',
        'var(--surface-2)',
      ].join(', '),
      border: '1px solid rgba(124,92,255,0.25)',
      boxShadow: '0 0 0 1px rgba(124,92,255,0.1), 0 18px 48px rgba(85,56,224,0.25)',
      overflow: 'hidden',
    }}>

      {/* Iris glow blob — top inline-end corner */}
      <div aria-hidden="true" style={{
        position: 'absolute',
        insetInlineEnd: -60,
        top: -60,
        width: 200,
        height: 200,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,92,255,0.4), transparent 70%)',
        filter: 'blur(20px)',
        pointerEvents: 'none',
      }} />

      {/* Icon + eyebrow label */}
      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-8)',
      }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 'var(--r-8)',
          background: 'rgba(124,92,255,0.15)',
          border: '1px solid rgba(124,92,255,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--primary-hi)',
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <span style={{
          fontSize: 'var(--fs-12)',
          fontWeight: 500,
          color: 'var(--ink-3)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          {label}
        </span>
      </div>

      {/* Hero number — gradient text via existing .text-hero-grad class */}
      <div
        className="num text-hero-grad"
        dir="ltr"
        style={{
          position: 'relative',
          fontSize: 'var(--fs-44)',
          fontWeight: 600,
          lineHeight: 1,
          marginTop: 'var(--s-16)',
          letterSpacing: '-0.025em',
        }}
      >
        {formatted}
      </div>

      {/* Decorative sparkline — purely visual, not connected to real data */}
      <svg
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{
          position: 'absolute',
          insetInlineStart: 0,
          insetInlineEnd: 0,
          bottom: 0,
          width: '100%',
          height: 50,
          opacity: 0.45,
          pointerEvents: 'none',
        }}
      >
        <defs>
          <linearGradient id="kpiHeroSparkFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#9B82FF" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#9B82FF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0,20 L10,18 L20,22 L30,15 L40,17 L50,12 L60,14 L70,8 L80,10 L90,5 L100,7 L100,30 L0,30 Z"
          fill="url(#kpiHeroSparkFill)"
        />
        <path
          d="M0,20 L10,18 L20,22 L30,15 L40,17 L50,12 L60,14 L70,8 L80,10 L90,5 L100,7"
          fill="none"
          stroke="#9B82FF"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
};

export default KPIHero;
