import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getShoppingListById } from '../../services/api';
import ShoppingListDetail from './ShoppingListDetail';
import ShoppingReceiptDialog from './ShoppingReceiptDialog';
import './ReceiptReviewPage.css';

export function ShoppingListRoute() {
  const { listId } = useParams();
  const navigate = useNavigate();
  return <ShoppingListDetail key={listId} listId={listId} onBack={() => navigate('/shopping')} />;
}

export default function ShoppingReceiptPage() {
  const { listId } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [failedListId, setFailedListId] = useState(null);
  useEffect(() => {
    let active = true;
    getShoppingListById(listId).then(({ data }) => { if (active) { setFailedListId(null); setList(data); } })
      .catch(() => { if (active) setFailedListId(listId); });
    return () => { active = false; };
  }, [listId]);
  if (failedListId === listId) return <main dir="rtl" role="alert">טעינת הרשימה נכשלה. <Link to={`/shopping/${listId}`}>חזרה לרשימה</Link></main>;
  if (String(list?.id) !== listId) return <main dir="rtl" role="status">טוען קבלה…</main>;
  return <ShoppingReceiptDialog key={listId} list={list} onExit={id => navigate(`/shopping/${id}`)}
    onTransfer={id => navigate(`/shopping/${id}/receipt`, { replace: true })}
    onChanged={async () => { const { data } = await getShoppingListById(listId); setList(data); }} />;
}
