import React, { useMemo } from 'react';

const fmt = (n) =>
  `₪${Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;

// ─── Cell state helpers ───────────────────────────────────────────────────────

function getCellState(planned, actual) {
  if (planned !== null && actual > 0) return 'normal';
  if (planned !== null && actual === 0) return 'budgeted_no_spend';
  if (planned === null && actual === 0) return 'no_data';
  return 'unplanned'; // planned === null && actual > 0
}

// ─── Trend calculation ────────────────────────────────────────────────────────

function computeTrend(totals, months, currentYearMonth) {
  const relevantMonths = months.filter((m) => {
    if (currentYearMonth && m >= currentYearMonth) return false;
    const t = totals.months[m];
    return t && (t.planned > 0 || t.actual > 0);
  });

  if (relevantMonths.length < 2) return null;

  const olderMonth  = relevantMonths[relevantMonths.length - 2];
  const recentMonth = relevantMonths[relevantMonths.length - 1];

  const olderDiff  = totals.months[olderMonth].diff;
  const recentDiff = totals.months[recentMonth].diff;
  const delta      = recentDiff - olderDiff;

  if (delta === 0) return null;

  return { delta, recentMonth, olderMonth };
}

// ─── Default visible months ───────────────────────────────────────────────────

function computeDefaultMonths(months, totals, currentYearMonth, count) {
  let relevant;
  if (currentYearMonth) {
    // Current year: only completed months (< currentYearMonth)
    relevant = months.filter((m) => {
      if (m >= currentYearMonth) return false;
      const t = totals.months[m];
      return t && (t.planned > 0 || t.actual > 0);
    });
  } else {
    // Past year: any month with data
    relevant = months.filter((m) => {
      const t = totals.months[m];
      return t && (t.planned > 0 || t.actual > 0);
    });
  }

  if (relevant.length === 0) return null; // triggers empty state
  return new Set(relevant.slice(-count));
}

// ─── MonthlyBreakdownTable ────────────────────────────────────────────────────

const MonthlyBreakdownTable = ({ data, monthRange, onMonthRangeChange }) => {
  const today = new Date();
  const currentYear = today.getFullYear();

  // The current calendar month string — used to exclude partial month from trend/defaults
  const currentYearMonth =
    data.year === currentYear
      ? `${data.year}-${String(today.getMonth() + 1).padStart(2, '0')}`
      : null;

  // Which months to display based on the range filter
  const visibleMonths = useMemo(() => {
    const count = monthRange === '3' ? 3 : monthRange === '6' ? 6 : null;

    if (count === null) {
      // Full year — show all 12
      return data.months;
    }

    // Compute relevant window
    const defaultSet = computeDefaultMonths(data.months, data.totals, currentYearMonth, count);
    if (!defaultSet) return data.months; // fallback: show all
    return data.months.filter((m) => defaultSet.has(m));
  }, [data, monthRange, currentYearMonth]);

  const trend = useMemo(
    () => computeTrend(data.totals, data.months, currentYearMonth),
    [data, currentYearMonth],
  );

  // Check for empty state
  const hasAnyData = data.months.some((m) => {
    const t = data.totals.months[m];
    return t && (t.planned > 0 || t.actual > 0);
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Trend banner */}
      {trend && (
        <div style={{
          ...bannerBase,
          background: trend.delta > 0 ? 'var(--pos-soft, rgba(74,222,128,0.12))' : 'var(--neg-soft)',
          borderColor: trend.delta > 0 ? 'var(--pos)' : 'var(--neg)',
          color: trend.delta > 0 ? 'var(--pos)' : 'var(--neg)',
          marginBottom: 14,
        }}>
          {trend.delta > 0
            ? `בחודש ${labelFor(data, trend.recentMonth)} חל שיפור של ${fmt(Math.abs(trend.delta))} בעמידה מול התקציב (לעומת ${labelFor(data, trend.olderMonth)})`
            : `בחודש ${labelFor(data, trend.recentMonth)} חלה הרעה של ${fmt(Math.abs(trend.delta))} בעמידה מול התקציב (לעומת ${labelFor(data, trend.olderMonth)})`
          }
        </div>
      )}

      {/* Month range filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, justifyContent: 'flex-end' }}>
        {[
          { key: '3', label: '3 חודשים' },
          { key: '6', label: '6 חודשים' },
          { key: 'full', label: 'שנה מלאה' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onMonthRangeChange(key)}
            style={{
              padding: '5px 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: monthRange === key ? 700 : 400,
              background: monthRange === key ? 'var(--primary-hi)' : 'var(--surface-3)',
              color: monthRange === key ? '#fff' : 'var(--ink-2)',
              transition: 'background 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {!hasAnyData && (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink-4)', fontSize: 14 }}>
          אין נתונים לתקופה זו
        </div>
      )}

      {/* Scrollable table */}
      {hasAnyData && (
        <div style={{ overflowX: 'auto', direction: 'rtl' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 13, direction: 'rtl' }}>
            <thead>
              {/* Row 1: month group headers */}
              <tr>
                <th style={stickyHeaderCell}>קטגוריה</th>
                {visibleMonths.map((m) => {
                  const isPartial = currentYearMonth && m === currentYearMonth;
                  return (
                    <th
                      key={m}
                      colSpan={3}
                      style={{
                        ...groupHeaderCell,
                        borderRight: '1px solid var(--border)',
                      }}
                    >
                      <div>{labelFor(data, m)}</div>
                      {isPartial && (
                        <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--ink-4)', marginTop: 1 }}>
                          חודש בתהליך
                        </div>
                      )}
                    </th>
                  );
                })}
                <th colSpan={3} style={{ ...groupHeaderCell, borderRight: '1px solid var(--border)' }}>
                  סה״כ שנתי
                </th>
              </tr>

              {/* Row 2: sub-headers */}
              <tr>
                <th style={{ ...stickyHeaderCell, top: 38, borderTop: '1px solid var(--border)' }} />
                {visibleMonths.map((m) => (
                  <React.Fragment key={m}>
                    <th style={subHeaderCell}>תקציב</th>
                    <th style={subHeaderCell}>בפועל</th>
                    <th style={{ ...subHeaderCell, borderLeft: '1px solid var(--border)' }}>הפרש</th>
                  </React.Fragment>
                ))}
                <th style={subHeaderCell}>תקציב</th>
                <th style={subHeaderCell}>בפועל</th>
                <th style={{ ...subHeaderCell, borderLeft: '1px solid var(--border)' }}>הפרש</th>
              </tr>
            </thead>

            <tbody>
              {data.rows.map((row, idx) => {
                const rowBg = idx % 2 === 0 ? 'var(--surface-2)' : 'var(--surface-3)';
                return (
                <tr key={row.category_id ?? '__null__'} style={{ background: rowBg }}>
                  {/* Category cell — sticky, must match row stripe */}
                  <td style={{ ...stickyBodyCell, background: rowBg }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 15, flexShrink: 0 }}>{row.icon || '🏷️'}</span>
                      <span style={{ fontWeight: 500, color: 'var(--ink-1)', whiteSpace: 'nowrap' }}>{row.name}</span>
                      {!row.is_budgeted_any_month && (
                        <span style={unbudgetedBadge}>לא מתוקצב</span>
                      )}
                    </div>
                  </td>

                  {/* Monthly cells */}
                  {visibleMonths.map((m) => {
                    const cell = row.months[m];
                    return (
                      <React.Fragment key={m}>
                        {renderCells(cell)}
                      </React.Fragment>
                    );
                  })}

                  {/* Yearly total */}
                  {renderCells(row.yearly)}
                </tr>
                );
              })}

              {/* Totals row */}
              <tr style={{ background: 'var(--surface-3)', borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td style={{ ...stickyBodyCell, background: 'var(--surface-3)', fontWeight: 700 }}>סה״כ</td>
                {visibleMonths.map((m) => {
                  const cell = data.totals.months[m];
                  return (
                    <React.Fragment key={m}>
                      {renderCells(cell)}
                    </React.Fragment>
                  );
                })}
                {renderCells(data.totals.yearly)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Cell renderer ────────────────────────────────────────────────────────────

function renderCells(cell) {
  if (!cell) {
    return (
      <>
        <td style={dataCell}><span style={mutedText}>—</span></td>
        <td style={dataCell}><span style={mutedText}>—</span></td>
        <td style={{ ...dataCell, borderLeft: '1px solid var(--border)' }}><span style={mutedText}>—</span></td>
      </>
    );
  }

  const { planned, actual, diff } = cell;
  const state = getCellState(planned, actual);

  const borderStyle = { borderLeft: '1px solid var(--border)' };

  if (state === 'no_data') {
    return (
      <>
        <td style={dataCell}><span style={mutedText}>—</span></td>
        <td style={dataCell}><span style={mutedText}>—</span></td>
        <td style={{ ...dataCell, ...borderStyle }}><span style={mutedText}>—</span></td>
      </>
    );
  }

  if (state === 'unplanned') {
    return (
      <>
        <td style={dataCell}>
          <span style={{ color: 'var(--warn)', fontSize: 11, whiteSpace: 'nowrap' }}>לא תוקצב</span>
        </td>
        <td style={dataCell}>
          <span style={{ color: 'var(--warn)', fontWeight: 600 }}>{fmt(actual)}</span>
        </td>
        <td style={{ ...dataCell, ...borderStyle }}>
          <span style={{ color: 'var(--neg)', fontSize: 11, whiteSpace: 'nowrap' }}>הוצ׳ לא מתוכננת</span>
        </td>
      </>
    );
  }

  // state === 'normal' or 'budgeted_no_spend'
  const diffColor = diff >= 0 ? 'var(--pos)' : 'var(--neg)';
  const diffText  = diff >= 0 ? `+${fmt(diff)}` : `-${fmt(Math.abs(diff))}`;

  return (
    <>
      <td style={dataCell}>{fmt(planned)}</td>
      <td style={dataCell}>{fmt(actual)}</td>
      <td style={{ ...dataCell, ...borderStyle, color: diffColor, fontWeight: 600 }}>
        {diffText}
      </td>
    </>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function labelFor(data, monthStr) {
  const idx = data.months.indexOf(monthStr);
  return idx >= 0 ? data.monthLabels[idx] : monthStr;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const bannerBase = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  border: '1px solid',
  borderRadius: 8,
  padding: '10px 14px',
  fontSize: 13,
};

const stickyHeaderCell = {
  position: 'sticky',
  right: 0,
  background: 'var(--surface-2)',
  zIndex: 3,
  padding: '10px 14px',
  textAlign: 'right',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-4)',
  borderBottom: '2px solid var(--border)',
  whiteSpace: 'nowrap',
  minWidth: 160,
};

const groupHeaderCell = {
  padding: '8px 6px',
  textAlign: 'center',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--ink-2)',
  borderBottom: '1px solid var(--border)',
  background: 'var(--surface-2)',
  whiteSpace: 'nowrap',
};

const subHeaderCell = {
  padding: '5px 8px',
  textAlign: 'center',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--ink-4)',
  borderBottom: '2px solid var(--border)',
  background: 'var(--surface-2)',
  whiteSpace: 'nowrap',
  minWidth: 72,
};

const stickyBodyCell = {
  position: 'sticky',
  right: 0,
  background: 'var(--surface-2)',
  zIndex: 2,
  padding: '9px 14px',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
};

const dataCell = {
  padding: '9px 10px',
  textAlign: 'center',
  borderBottom: '1px solid var(--border)',
  color: 'var(--ink-2)',
  whiteSpace: 'nowrap',
};

const mutedText = { color: 'var(--ink-5)', fontSize: 12 };

const unbudgetedBadge = {
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--warn)',
  background: 'rgba(255,192,97,0.12)',
  borderRadius: 9999,
  padding: '1px 7px',
  marginRight: 4,
  flexShrink: 0,
};

export default MonthlyBreakdownTable;
