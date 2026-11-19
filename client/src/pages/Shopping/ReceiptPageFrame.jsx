import { Fragment } from 'react';

const steps = [['upload','קבלה'], ['review','בדיקה ותיקון'], ['approval','אישור להיסטוריה']];

export default function ReceiptPageFrame({ children, footer, step, onStep, hasReceipt, store, date, pages,
  busy, confirmed, total, printed, difference, incomplete, listTitle, toolsOpen, toggleTools }) {
  const balanced = difference === '0.00' && !incomplete;
  return <div className="rr-page" dir="rtl">
    <header className="rr-bar"><div><b aria-hidden="true">₪</b><strong>מעקב פיננסי</strong><span>‹ רשימות קניות ‹ {listTitle}</span></div></header>
    <main className="rr-shell">
      <nav className="rr-steps" aria-label="שלבי הבדיקה">{steps.map(([key,label], i) => <Fragment key={key}>
        {i > 0 && <i aria-hidden="true"/>}<button aria-current={step === key ? 'step' : undefined}
          disabled={busy || (!hasReceipt && i > 0) || (confirmed && key !== 'review')}
          onClick={() => onStep(key)}><span>{i+1}</span>{label}</button></Fragment>)}</nav>
      <div className={step === 'approval' ? 'rr-panel rr-approval' : undefined}>
        <header className="rr-title"><h1>{confirmed && step === 'approval' ? 'הקנייה נשמרה להיסטוריה' : step === 'approval' ? 'אישור הקנייה להיסטוריה' : step === 'upload' ? 'טעינת קבלה' : 'בדיקת קבלה'}</h1>
          {hasReceipt && step !== 'upload' && <button className="rr-tools rr-text" aria-expanded={toolsOpen} disabled={busy} onClick={toggleTools}>פרטי קבלה וכלים</button>}
        </header>
        <p className="rr-meta">{[store, date?.split('-').reverse().join('.'), pages === 1 ? 'עמוד אחד' : pages ? `${pages} עמודים` : ''].filter(Boolean).join(' · ')}</p>
        {hasReceipt && step === 'approval' && balanced && <dl className="rr-matched-total">
          <dt><span aria-hidden="true">✓</span> הסכום תואם לקבלה</dt>
          <dd><bdi dir="ltr">₪{total}</bdi></dd>
        </dl>}
        {hasReceipt && step !== 'upload' && !(step === 'approval' && balanced) && <dl className="rr-metrics" aria-label="התאמת סכום הקבלה">
          <div><dt>שולם לפי הקבלה</dt><dd>{printed == null ? 'לא ידוע' : <bdi>₪{printed}</bdi>}</dd></div>
          <div><dt>סכום השורות{incomplete && ' · חלקי'}</dt><dd><bdi>₪{total}</bdi></dd></div>
          <div className={difference == null ? '' : balanced ? 'balanced' : 'difference'}><dt>פער בסכום</dt><dd>{difference == null ? '—' : <bdi dir="ltr">{difference} ₪</bdi>}</dd></div>
        </dl>}
        {children}
        {step === 'approval' && <div className="rr-approval-actions">{footer}</div>}
      </div>
    </main>
    {step !== 'approval' && <footer className="rr-footer"><div>{footer}</div></footer>}
  </div>;
}
