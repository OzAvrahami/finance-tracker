import { Alert } from "../../components/ui";

export default function ReceiptDuplicateWarning({ candidates = [], checked, onChange }) {
  if (!candidates.length) return <p>אין התאמה למזהי קבלה זמינים. זו אינה הוכחה שאין כפילות: צילום שונה או מזהים חסרים עלולים לא להתגלות. בדקו גם קניות שכבר נסגרו.</p>;
  return <Alert title="ייתכן שהקבלה כבר קיימת ברשימה אחרת">
    <p>נמצאו אותו מספר קבלה, בית עסק ותאריך מודפס. זו אזהרה לבדיקה, לא הוכחת זהות. אם זו אותה קנייה, בטלו כאן והמשיכו ברשימה המקורית; אישור נוסף עלול להכפיל היסטוריה וסגירה נוספת עלולה להכפיל הוצאה.</p>
    <ul>{candidates.map(c => <li key={c.receipt_id}>
      <strong>{c.list_title}</strong> (רשימה {c.list_id}) · {c.identity.merchant} · קבלה {c.identity.receipt_number} · {c.identity.purchase_date}
      {c.history_confirmed ? " · היסטוריית קנייה כבר אושרה" : " · הקבלה בבדיקה"}
      {c.transaction_id ? ` · כבר נוצרה הוצאה: ₪${c.checkout_total} (תנועה ${c.transaction_id})` : " · טרם נוצרה הוצאה בסגירת הרשימה"}
    </li>)}</ul>
    <label className="shopping-review-check"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />בדקתי את הרשימות המוצגות; אלו רכישות נפרדות ואני מאשר/ת המשך למרות האזהרה</label>
  </Alert>;
}
