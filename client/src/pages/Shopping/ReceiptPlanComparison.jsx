export default function ReceiptPlanComparison({fulfillment}) {
  if(!fulfillment.length)return null;
  return <section aria-label="השוואה לתוכנית">
    <h3>התוכנית מול הקנייה</h3>
    <ul>{fulfillment.map((p,i)=><li key={p.list_item_id??i}>
      <strong>{p.name}</strong>: {p.purchased_quantity} מתוך {p.quantity} {p.unit} · {{full:'נרכש במלואו',partial:'נרכש חלקית',absent:'לא נמצא בקבלה',unresolved:'התאמה או המרת כמות לא פתורה'}[p.status]}
      {p.matches.map(m=><span key={m.row_id}> · {m.name}</span>)}
    </li>)}</ul>
    <p>אי־זיהוי לא מבטל סימון ידני. התאמות חדשות יישמרו רק באישור הקבלה.</p>
  </section>;
}
