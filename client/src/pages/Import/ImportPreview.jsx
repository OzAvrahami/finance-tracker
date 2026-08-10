import {
  AlertTriangle,
  Check,
  FileSpreadsheet,
  Trash2,
} from 'lucide-react';
import CategoryCombobox from '../../components/CategoryCombobox';
import {
  Alert,
  EmptyState,
  IconButton,
  MoneyAmount,
  PrimaryButton,
  SecondaryButton,
  TechnicalValue,
} from '../../components/ui';

const hasValue = (value) => value !== null && value !== undefined && value !== '';

const OriginalAmount = ({ row }) => {
  if (!hasValue(row.original_amount)) return <span className="import-muted-value">—</span>;

  return (
    <span className="import-original-amount">
      <span>
        <MoneyAmount
          value={row.original_amount}
          currency={false}
          minimumFractionDigits={2}
          maximumFractionDigits={2}
        />
        {' '}
        <TechnicalValue>{row.currency || 'ILS'}</TechnicalValue>
      </span>
      {hasValue(row.exchange_rate) && (
        <small>
          שער <TechnicalValue>{row.exchange_rate}</TechnicalValue>
        </small>
      )}
    </span>
  );
};

const CategoryControl = ({ row, categories, onCategoryChange, onCreateCategory }) => (
  <div className="import-category-control">
    {!row.category_id && (
      <span className="import-uncategorized-label">
        <AlertTriangle size={13} aria-hidden="true" />
        ללא קטגוריה
      </span>
    )}
    <CategoryCombobox
      ariaLabel={`קטגוריה עבור ${row.description || 'תנועה'}`}
      categories={categories}
      selectedCategoryId={row.category_id}
      size="compact"
      placeholder="בחירת קטגוריה"
      onSelect={(categoryId) => onCategoryChange(row.id, categoryId)}
      onOpenNewModal={(categoryName) => onCreateCategory(row.id, categoryName)}
    />
  </div>
);

const ImportPreviewTable = ({ rows, categories, onCategoryChange, onCreateCategory, onRemove }) => (
  <div className="import-preview-table-region" role="region" aria-label="טבלת תצוגה מקדימה" tabIndex="0">
    <table className="import-preview-table">
      <caption>תנועות שנקלטו מהקובץ לפני שמירה</caption>
      <colgroup>
        <col className="import-col-date" />
        <col className="import-col-description" />
        <col className="import-col-amount" />
        <col className="import-col-original" />
        <col className="import-col-installments" />
        <col className="import-col-category" />
        <col className="import-col-actions" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">תאריך</th>
          <th scope="col">תיאור</th>
          <th scope="col">סכום ₪</th>
          <th scope="col">סכום מקורי</th>
          <th scope="col">תשלומים</th>
          <th scope="col">קטגוריה</th>
          <th scope="col">פעולות</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={!row.category_id ? 'is-uncategorized' : ''}>
            <td><TechnicalValue className="import-date">{row.transaction_date}</TechnicalValue></td>
            <td>
              <div className="import-description" dir="auto">{row.description}</div>
              {row.notes && <p className="import-row-note" dir="auto">{row.notes}</p>}
            </td>
            <td>
              <MoneyAmount
                className="import-preview-amount"
                value={row.total_amount}
                minimumFractionDigits={2}
                maximumFractionDigits={2}
              />
            </td>
            <td><OriginalAmount row={row} /></td>
            <td>
              {row.installments_info
                ? <span className="import-installments" dir="auto">{row.installments_info}</span>
                : <span className="import-muted-value">—</span>}
            </td>
            <td>
              <CategoryControl
                row={row}
                categories={categories}
                onCategoryChange={onCategoryChange}
                onCreateCategory={onCreateCategory}
              />
            </td>
            <td>
              <IconButton
                type="button"
                size={36}
                className="import-remove-row"
                aria-label={`הסרת השורה ${row.description || row.id} מהייבוא`}
                onClick={() => onRemove(row.id)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </IconButton>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ImportPreviewCards = ({ rows, categories, onCategoryChange, onCreateCategory, onRemove }) => (
  <div className="import-preview-cards" aria-label="כרטיסי תצוגה מקדימה">
    {rows.map((row) => (
      <article
        key={row.id}
        className={`import-preview-card${!row.category_id ? ' is-uncategorized' : ''}`}
        aria-label={`תנועה מיובאת: ${row.description}`}
      >
        <header className="import-preview-card__header">
          <div>
            <TechnicalValue className="import-date">{row.transaction_date}</TechnicalValue>
            <h3 dir="auto">{row.description}</h3>
          </div>
          <MoneyAmount
            className="import-preview-amount"
            value={row.total_amount}
            minimumFractionDigits={2}
            maximumFractionDigits={2}
          />
        </header>

        {(hasValue(row.original_amount) || row.installments_info || row.notes) && (
          <div className="import-preview-card__details">
            {hasValue(row.original_amount) && (
              <span>
                <small>סכום מקורי</small>
                <OriginalAmount row={row} />
              </span>
            )}
            {row.installments_info && (
              <span>
                <small>תשלומים</small>
                <span dir="auto">{row.installments_info}</span>
              </span>
            )}
            {row.notes && <p className="import-row-note" dir="auto">{row.notes}</p>}
          </div>
        )}

        <div className="import-preview-card__category">
          <CategoryControl
            row={row}
            categories={categories}
            onCategoryChange={onCategoryChange}
            onCreateCategory={onCreateCategory}
          />
          <IconButton
            type="button"
            size="touch"
            className="import-remove-row"
            aria-label={`הסרת השורה ${row.description || row.id} מהייבוא`}
            onClick={() => onRemove(row.id)}
          >
            <Trash2 size={17} aria-hidden="true" />
          </IconButton>
        </div>
      </article>
    ))}
  </div>
);

const ImportPreview = ({
  rows,
  totalRows,
  categories,
  fileName,
  saving,
  saveError,
  onDismissError,
  onCategoryChange,
  onCreateCategory,
  onRemove,
  onBack,
  onSave,
}) => {
  const categorizedCount = rows.filter((row) => Boolean(row.category_id)).length;
  const uncategorizedCount = rows.length - categorizedCount;
  const removedCount = Math.max(0, totalRows - rows.length);
  const parserReturnedEmpty = totalRows === 0;

  if (rows.length === 0) {
    return (
      <EmptyState
        className="import-preview-empty"
        icon={FileSpreadsheet}
        title={parserReturnedEmpty ? 'לא נמצאו תנועות בקובץ' : 'לא נותרו שורות לשמירה'}
        description={parserReturnedEmpty
          ? 'הקובץ פוענח, אך לא נמצאו בו שורות שמתאימות לפרופיל שנבחר.'
          : 'כל השורות שנקלטו מהקובץ הוסרו מהתצוגה המקדימה.'}
        primaryAction={(
          <SecondaryButton type="button" onClick={onBack}>
            חזרה לבחירת קובץ
          </SecondaryButton>
        )}
      />
    );
  }

  return (
    <section className="import-preview" aria-label="בדיקת התנועות לפני שמירה">
      <header className="import-preview__summary">
        <div className="import-preview__stats" aria-label="סיכום התצוגה המקדימה">
          <span className="import-stat">
            <FileSpreadsheet size={14} aria-hidden="true" />
            <strong>{totalRows}</strong> שורות נקלטו
          </span>
          <span className="import-stat import-stat--success">
            <Check size={14} aria-hidden="true" />
            <strong>{categorizedCount}</strong> מסווגות
          </span>
          <span className={`import-stat${uncategorizedCount ? ' import-stat--warning' : ' import-stat--success'}`}>
            {uncategorizedCount ? <AlertTriangle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
            <strong>{uncategorizedCount}</strong> ללא קטגוריה
          </span>
          <span className="import-stat">
            <Trash2 size={14} aria-hidden="true" />
            <strong>{removedCount}</strong> הוסרו
          </span>
        </div>
        {fileName && <TechnicalValue className="import-preview__filename">{fileName}</TechnicalValue>}
      </header>

      {uncategorizedCount > 0 && (
        <div className="import-preview__warning" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <span><strong>{uncategorizedCount}</strong> שורות דורשות תשומת לב — לא נמצאה להן קטגוריה מתאימה.</span>
        </div>
      )}

      {saveError && (
        <Alert className="import-save-error" variant="error" urgent onDismiss={onDismissError}>
          {saveError}
        </Alert>
      )}

      <ImportPreviewTable
        rows={rows}
        categories={categories}
        onCategoryChange={onCategoryChange}
        onCreateCategory={onCreateCategory}
        onRemove={onRemove}
      />
      <ImportPreviewCards
        rows={rows}
        categories={categories}
        onCategoryChange={onCategoryChange}
        onCreateCategory={onCreateCategory}
        onRemove={onRemove}
      />

      <footer className="import-preview__actions">
        <SecondaryButton type="button" disabled={saving} onClick={onBack}>
          <span aria-hidden="true">→</span>
          חזרה
        </SecondaryButton>
        <span className="import-preview__save-context">
          <strong>{rows.length}</strong> תנועות מוכנות לשמירה
        </span>
        <PrimaryButton
          type="button"
          size="lg"
          loading={saving}
          loadingText="שומר תנועות…"
          disabled={rows.length === 0}
          onClick={onSave}
        >
          שמירת {rows.length} תנועות
        </PrimaryButton>
      </footer>
    </section>
  );
};

export default ImportPreview;
