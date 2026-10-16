import {useState} from 'react';
import {Alert, SecondaryButton} from '../../components/ui';

export default function ReceiptStoreReview({review, conflict, conflictReviewed, onConflictReview,
  acknowledgment, onAcknowledge, onCancel, onStore, onLists, lists, onMove}) {
  const [store,setStore]=useState(''),[target,setTarget]=useState('');
  return <section className="receipt-store-review" aria-label="אימות חנות">
    <Alert variant={review.state==='matched'?'info':'warning'}>
      <strong>{review.state==='matched'?'החנות תואמת':review.state==='mismatch'?'הקבלה שייכת לחנות אחרת':review.state==='missing_store'?'לא הוגדרה חנות לרשימה':'זהות החנות אינה פתורה'}</strong>
      <p>חנות הרשימה: {review.store||'לא הוגדרה'} · חנות בקבלה: {review.merchant||'לא זוהתה'}</p>
      {review.state!=='matched' && <>
        <SecondaryButton onClick={onCancel}>ביטול</SecondaryButton>
        <SecondaryButton onClick={onLists}>בחירת רשימה קיימת אחרת</SecondaryButton>
        <label>תיקון חנות הרשימה <input aria-label="תיקון חנות הרשימה" value={store} onChange={e=>setStore(e.target.value)} placeholder={review.merchant??''}/></label>
        <SecondaryButton disabled={!store.trim()&&!review.merchant} onClick={()=>onStore(store.trim()||review.merchant)}>שמירת החנות לרשימה</SecondaryButton>
        <label><input type="checkbox" checked={acknowledgment===review.acknowledgment} onChange={e=>onAcknowledge(e.target.checked?review.acknowledgment:'')}/>בדקתי את החנויות ואני בוחר להמשיך {review.state==='missing_store'?'ללא אימות חנות':'למרות האזהרה'}</label>
      </>}
      {lists && <div>
        <select aria-label="רשימה חלופית" value={target} onChange={e=>setTarget(e.target.value)}>
          <option value="">בחירת רשימה לא ריקה</option>
          {lists.map(l=><option key={l.id} value={l.id}>{l.title} · {l.store||'ללא חנות'}</option>)}
        </select>
        {!lists.length&&<p>אין רשימה פתוחה ולא ריקה אחרת.</p>}
        <SecondaryButton disabled={!target} onClick={()=>onMove(target)}>העברת הטיוטה לרשימה שנבחרה</SecondaryButton>
      </div>}
    </Alert>
    {conflict&&<Alert variant="warning"><p>פרטי הקבלה סותרים. ודאו שכל הקבצים שייכים לאותה קבלה; אם לא, בטלו וסרקו קבלה אחת בלבד.</p><label><input type="checkbox" checked={conflictReviewed} onChange={e=>onConflictReview(e.target.checked)}/>בדקתי את הסתירות: זו קבלה אחת</label></Alert>}
  </section>;
}
