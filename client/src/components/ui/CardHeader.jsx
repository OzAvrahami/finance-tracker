import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Reusable card header: title + optional hint + optional action link.
 * Props:
 *   title  – string, required
 *   hint   – string, optional subtitle below title
 *   action – { label, to } — renders a right-side Link
 *   style  – extra inline styles for the wrapper div
 */
const CardHeader = ({ title, hint, action, style }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 'var(--s-20)',
    ...style,
  }}>
    <div>
      <h3 style={{
        margin: 0,
        fontSize: 'var(--fs-16)',
        fontWeight: 700,
        color: 'var(--ink-1)',
        letterSpacing: '-0.01em',
      }}>
        {title}
      </h3>
      {hint && (
        <p style={{ margin: '2px 0 0', fontSize: 'var(--fs-12)', color: 'var(--ink-4)' }}>
          {hint}
        </p>
      )}
    </div>
    {action?.to && (
      <Link
        to={action.to}
        style={{
          fontSize: 'var(--fs-13)',
          color: 'var(--primary-hi)',
          textDecoration: 'none',
          fontWeight: 500,
          transition: 'color 0.15s',
        }}
      >
        {action.label}
      </Link>
    )}
  </div>
);

export default CardHeader;
