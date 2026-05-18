import React from 'react';
import { GlassCard } from './Card';
import MoneyAmount from './MoneyAmount';

const accentMap = {
  iris:  { color: 'var(--primary-hi)', bg: 'var(--primary-soft)', border: 'rgba(124,92,255,0.25)' },
  mint:  { color: 'var(--pos)',        bg: 'var(--pos-soft)',      border: 'rgba(74,222,154,0.25)'  },
  coral: { color: 'var(--neg)',        bg: 'var(--neg-soft)',      border: 'rgba(255,122,138,0.25)' },
  cyan:  { color: 'var(--info)',       bg: 'var(--info-soft)',     border: 'rgba(90,200,255,0.25)'  },
  amber: { color: 'var(--warn)',       bg: 'var(--warn-soft)',     border: 'rgba(255,192,97,0.25)'  },
};

/**
 * Standard KPI tile — glass card with accent icon container.
 *
 * Props:
 *   label      – eyebrow label (uppercase)
 *   value      – number, required
 *   icon       – React element (Lucide icon at size 13)
 *   accent     – 'iris' | 'mint' | 'coral' | 'cyan' | 'amber' (default 'iris')
 *   valueColor – optional CSS color override for the number (e.g. 'var(--pos)')
 */
const KPICard = ({ label, value, icon, accent = 'iris', valueColor }) => {
  const a = accentMap[accent] ?? accentMap.iris;

  return (
    <GlassCard
      padding="var(--s-20)"
      style={{ minHeight: 144, display: 'flex', flexDirection: 'column', gap: 'var(--s-12)' }}
    >
      {/* Icon + eyebrow label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-8)' }}>
        <div style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          backgroundColor: a.bg,
          border: `1px solid ${a.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: a.color,
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

      {/* Value */}
      <MoneyAmount
        value={value}
        size="var(--fs-32)"
        style={{
          fontWeight: 600,
          letterSpacing: '-0.022em',
          lineHeight: 1,
          color: valueColor || 'var(--ink-1)',
        }}
      />
    </GlassCard>
  );
};

export default KPICard;
