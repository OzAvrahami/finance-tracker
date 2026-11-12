import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, GlassCard, SecondaryButton, Tab, TabList, TabPanel, Tabs } from '../../../components/ui';
import { createPreviewApi } from '../services/catalogApi';
import CategoriesPanel from './CategoriesPanel';
import ProductsPanel from './ProductsPanel';
import ListTypesPanel from './ListTypesPanel';
import './shoppingAdmin.css';

export default function ShoppingCatalogAdmin({ adapter }) {
  const [api] = useState(() => adapter || createPreviewApi({ enabled: import.meta.env.DEV && import.meta.env.VITE_SHOPPING_ADMIN_PREVIEW === '1' }));
  const [data, setData] = useState(null), [error, setError] = useState(null), [tab, setTab] = useState('categories');
  const [visited, setVisited] = useState(['categories']);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    try { const result = await api.read(); if (version === generation.current) { setData(result); setError(null); } return result; }
    catch (failure) { if (version === generation.current) setError(failure); throw failure; }
  }, [api]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    Promise.resolve().then(refresh).catch(() => {});
    const focus = () => refresh().catch(() => {});
    window.addEventListener('focus', focus);
    return () => { invalidate(); window.removeEventListener('focus', focus); };
  }, [refresh, invalidate]);
  return <main className="shopping-admin" dir="rtl">
    <header><a href="/settings">הגדרות Finance Tracker</a><h1>ניהול קטלוג הקניות</h1><p>קטגוריות, מוצרים וזמינות לפי סוג רשימה</p></header>
    <Alert variant="warning">{api.mode === 'isolated' ? 'סביבת בדיקה מקומית מבודדת · נתונים מלאכותיים · השינויים נשמרים במסד המקומי. אין חיבור לייצור.' : 'הדגמה מקומית בלבד · נתונים מלאכותיים · השינויים נשמרים בזיכרון ונמחקים בהפעלה מחדש של שרת הפיתוח. אין חיבור לנתוני הקניות האמיתיים.'}</Alert>
    {data && api.mode === 'isolated' && <p aria-label="גרסת קטלוג">גרסת קטלוג: {data.etag}</p>}
    {error && <Alert variant="error" urgent>{error.message}<SecondaryButton onClick={() => refresh().catch(() => {})}>ניסיון חוזר לטעינה</SecondaryButton></Alert>}
    {!data && !error && <p role="status">טוען קטלוג הדגמה…</p>}
    {data && <GlassCard><Tabs value={tab} onValueChange={value => { setTab(value); setVisited(previous => previous.includes(value) ? previous : [...previous, value]); }}>
      <TabList aria-label="ניהול קטלוג"><Tab value="categories">קטגוריות</Tab><Tab value="products">מוצרים</Tab><Tab value="types">סוגי רשימות</Tab></TabList>
      <TabPanel value="categories"><CategoriesPanel {...{ data, api, refresh }} /></TabPanel>
      <TabPanel value="products">{visited.includes('products') && <ProductsPanel {...{ data, api, refresh }} />}</TabPanel>
      <TabPanel value="types">{visited.includes('types') && <ListTypesPanel {...{ data, api, refresh }} />}</TabPanel>
    </Tabs></GlassCard>}
  </main>;
}
