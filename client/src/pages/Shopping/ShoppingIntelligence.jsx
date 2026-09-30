import ShoppingReceiptDialog from "./ShoppingReceiptDialog";
import PersonalItemProducts from './PersonalItemProducts';
import { useState } from "react";
import {
  Alert,
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  TextField,
  NumberField,
  Select,
} from "../../components/ui";
import {
  getShoppingIntelligence,
  saveShoppingRegular,
  removeShoppingRegular,
  acceptShoppingSuggestion,
} from "../../services/api";
export default function ShoppingIntelligence({ list, onChanged }) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]),
    [skipped, setSkipped] = useState([]);
  const [product, setProduct] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [unit, setUnit] = useState("יח׳");
  const editable = ["draft", "active"].includes(list.status);
  async function load() {
    const { data: next } = await getShoppingIntelligence(list.id);
    setData(next);
    setSuggestions(next.suggestions);
  }
  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError("הפעולה לא הושלמה. המידע הקיים נשמר; אפשר לנסות שוב.");
    } finally {
      setBusy(false);
    }
  }
  const refresh = () => run(load);
  const existing = new Set(
    (list.shopping_list_items ?? []).map((i) => String(i.catalog_item_id)),
  );
  const visible = suggestions.filter(
    (s) =>
      !skipped.includes(s.catalog_item_id) && !existing.has(s.catalog_item_id),
  );
  const accept = async (s) => {
    await acceptShoppingSuggestion(list.id, {
      catalog_item_id: s.catalog_item_id,
      quantity: s.quantity,
      unit: s.unit,
    });
    await onChanged();
  };
  return (
    <GlassCard className="shopping-intelligence" padding="var(--ft-space-7)">
      <SecondaryButton
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && !data) refresh();
        }}
      >
        מוצרים קבועים, הצעות וקבלות
      </SecondaryButton>
      {open && (
        <section aria-label="תכנון קנייה ובדיקת קבלה" dir="rtl">
          <p>הצעות מבוססות רק על קניות שאושרו. אין כאן מעקב אחר המלאי בבית.</p>
          {busy && <p role="status">מעבד…</p>}
          {error && <Alert variant="error">{error}</Alert>}
          <SecondaryButton disabled={busy} onClick={refresh}>
            רענון
          </SecondaryButton>
          {data && (
            <>
              <PersonalItemProducts catalog={data.catalog} listTypeId={list.list_type_id}/>
              {editable && (
                <>
                  <h3>המוצרים הקבועים שלי</h3>
                  <p>
                    אין היסטוריה? בחרו מוצרים וכמויות רגילות מהקטלוג. מוצר חדש
                    אפשר להוסיף דרך הוספת פריט לרשימה ואז לרענן כאן.
                  </p>
                  <form
                    className="shopping-smart-grid"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(async () => {
                        await saveShoppingRegular(product, { quantity, unit });
                        await load();
                      });
                    }}
                  >
                    <Select
                      label="מוצר קבוע"
                      required
                      value={product}
                      onValueChange={setProduct}
                    >
                      <option value="">בחירת מוצר</option>
                      {data.catalog.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <NumberField
                      label="כמות רגילה"
                      required
                      min="0.001"
                      step="0.001"
                      value={quantity}
                      onValueChange={setQuantity}
                    />
                    <TextField
                      label="יחידה רגילה"
                      required
                      value={unit}
                      onValueChange={setUnit}
                    />
                    <PrimaryButton type="submit" disabled={busy || !product}>
                      שמירת מוצר קבוע
                    </PrimaryButton>
                  </form>
                  {suggestions
                    .filter((s) => s.regular)
                    .map((s) => (
                      <div
                        className="shopping-smart-row"
                        key={s.catalog_item_id}
                      >
                        <span>
                          {s.name} · {s.quantity} {s.unit}
                        </span>
                        <SecondaryButton
                          disabled={busy}
                          onClick={() => {
                            setProduct(s.catalog_item_id);
                            setQuantity(s.quantity);
                            setUnit(s.unit);
                          }}
                        >
                          עריכת הרגל: {s.name}
                        </SecondaryButton>
                        <SecondaryButton
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await removeShoppingRegular(s.catalog_item_id);
                              await load();
                            })
                          }
                        >
                          הסרת הרגל: {s.name}
                        </SecondaryButton>
                      </div>
                    ))}
                  <h3>הצעות לרשימה</h3>
                  {!visible.length && (
                    <p>
                      אין הצעות נוספות. אפשר לבחור מוצרים קבועים, או להוסיף
                      פריטים ידנית.
                    </p>
                  )}
                  {visible.map((s) => (
                    <article
                      className="shopping-smart-row"
                      key={s.catalog_item_id}
                    >
                      <div>
                        <strong>{s.name}</strong>
                        <p>{s.explanation}</p>
                      </div>
                      <NumberField
                        label={`כמות מוצעת: ${s.name}`}
                        min="0.001"
                        step="0.001"
                        value={s.quantity}
                        onValueChange={(v) =>
                          setSuggestions((all) =>
                            all.map((a) =>
                              a.catalog_item_id === s.catalog_item_id
                                ? { ...a, quantity: v }
                                : a,
                            ),
                          )
                        }
                      />
                      <TextField
                        label={`יחידה מוצעת: ${s.name}`}
                        value={s.unit}
                        onValueChange={(v) =>
                          setSuggestions((all) =>
                            all.map((a) =>
                              a.catalog_item_id === s.catalog_item_id
                                ? { ...a, unit: v }
                                : a,
                            ),
                          )
                        }
                      />
                      <SecondaryButton
                        disabled={busy}
                        onClick={() => run(() => accept(s))}
                      >
                        הוספה: {s.name}
                      </SecondaryButton>
                      <SecondaryButton
                        disabled={busy}
                        onClick={() =>
                          setSkipped([...skipped, s.catalog_item_id])
                        }
                      >
                        דילוג: {s.name}
                      </SecondaryButton>
                    </article>
                  ))}
                  {!!visible.length && (
                    <PrimaryButton
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          for (const s of visible) await accept(s);
                        })
                      }
                    >
                      יצירת רשימה מההצעות
                    </PrimaryButton>
                  )}
                  {!!skipped.length && (
                    <SecondaryButton onClick={() => setSkipped([])}>
                      הצגת הצעות שדולגו
                    </SecondaryButton>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}
      <ShoppingReceiptDialog list={list} onChanged={onChanged} />
    </GlassCard>
  );
}
