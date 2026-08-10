import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, FileSpreadsheet } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert,
  ConfirmDialog,
  Dialog,
  ErrorState,
  FileUpload,
  PrimaryButton,
  SecondaryButton,
  Select,
  Skeleton,
  TextField,
  useToast,
} from '../../components/ui';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  createCategory,
  getCategories,
  getPaymentSources,
  saveImportedTransactions,
  uploadImportFile,
} from '../../services/api';
import ImportPreview from './ImportPreview';
import './Import.css';

const IMPORT_PROFILES = [
  { value: 'cal_bank', label: 'כרטיס אשראי - כאל בנקאי (Cal)' },
  { value: 'debit_bank', label: 'כרטיס דיירקט בנק' },
  { value: 'cal', label: 'כרטיס אשראי - כאל (Cal)' },
  { value: 'max', label: 'כרטיס אשראי - מקס (Max)' },
];

const SUPPORTED_FILE_PATTERN = /\.(csv|xls|xlsx)$/i;

const ImportStepper = ({ step }) => (
  <nav className="import-stepper" aria-label="שלבי ייבוא תנועות">
    <div className={`import-step${step === 1 ? ' is-active' : ' is-complete'}`} aria-current={step === 1 ? 'step' : undefined}>
      <span className="import-step__badge" aria-hidden="true">1</span>
      <span>
        <strong>בחירת קובץ</strong>
        <small>פרופיל, אמצעי תשלום וקובץ</small>
      </span>
    </div>
    <span className="import-stepper__line" aria-hidden="true" />
    <div className={`import-step${step === 2 ? ' is-active' : ''}`} aria-current={step === 2 ? 'step' : undefined}>
      <span className="import-step__badge" aria-hidden="true">2</span>
      <span>
        <strong>בדיקה ושמירה</strong>
        <small>סיווג התנועות שנקלטו</small>
      </span>
    </div>
  </nav>
);

const ImportSetupSkeleton = () => (
  <div className="import-setup import-setup--skeleton" role="status" aria-label="טעינת נתוני הייבוא">
    <span className="import-visually-hidden">טוען קטגוריות ואמצעי תשלום</span>
    <div className="import-setup__grid" aria-hidden="true">
      <Skeleton height={70} borderRadius="var(--ft-radius-control)" />
      <Skeleton height={70} borderRadius="var(--ft-radius-control)" />
    </div>
    <Skeleton height={176} borderRadius="var(--ft-radius-lg)" aria-hidden="true" />
  </div>
);

const Import = () => {
  const { setPageHeader } = useContext(PageHeaderContext);
  const navigate = useNavigate();
  const toast = useToast();
  const newCategoryInputRef = useRef(null);
  const categoryReturnFocusRef = useRef(null);
  const [file, setFile] = useState(null);
  const [profile, setProfile] = useState('cal_bank');
  const [previewData, setPreviewData] = useState([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [paymentSources, setPaymentSources] = useState([]);
  const [selectedPaymentSourceId, setSelectedPaymentSourceId] = useState('');
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [fileTypeError, setFileTypeError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [step, setStep] = useState(1);
  const [setupTouched, setSetupTouched] = useState(false);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [targetRowId, setTargetRowId] = useState(null);
  const [showUncategorizedConfirm, setShowUncategorizedConfirm] = useState(false);

  useEffect(() => {
    setPageHeader({
      title: 'ייבוא תנועות',
      subtitle: 'קליטת דפי בנק וכרטיסי אשראי בשני צעדים',
    });
  }, [setPageHeader]);

  const loadReferenceData = useCallback(async () => {
    setReferenceLoading(true);
    setReferenceError(false);
    try {
      const [categoryResponse, paymentSourceResponse] = await Promise.all([
        getCategories(),
        getPaymentSources(),
      ]);
      const nextCategories = Array.isArray(categoryResponse.data) ? categoryResponse.data : [];
      const nextPaymentSources = Array.isArray(paymentSourceResponse.data) ? paymentSourceResponse.data : [];
      setCategories(nextCategories);
      setPaymentSources(nextPaymentSources);
      setSelectedPaymentSourceId((current) => current || nextPaymentSources[0]?.id || '');
      return true;
    } catch {
      setReferenceError(true);
      return false;
    } finally {
      setReferenceLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  const savableRows = useMemo(() => previewData.filter(
    (row) => row.transaction_date && row.transaction_date.trim() !== '',
  ), [previewData]);
  const uncategorizedSaveCount = useMemo(
    () => savableRows.filter((row) => !row.category_id).length,
    [savableRows],
  );

  const handleFilesChange = (files) => {
    const nextFile = files[0] || null;
    setFile(nextFile);
    setFileTypeError(nextFile && !SUPPORTED_FILE_PATTERN.test(nextFile.name)
      ? 'סוג הקובץ אינו נתמך. ניתן לייבא קבצי CSV, XLS ו־XLSX בלבד.'
      : '');
    setPreviewError('');
  };

  const handleUpload = async () => {
    setSetupTouched(true);
    if (!file || fileTypeError || !profile || !selectedPaymentSourceId || previewPending) return;

    setPreviewPending(true);
    setPreviewError('');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('profile', profile);

    try {
      const response = await uploadImportFile(formData);
      const rows = Array.isArray(response.data?.previewData) ? response.data.previewData : [];
      const dataWithCategories = rows.map((row) => ({
        ...row,
        category_id: row.suggested_category ? row.suggested_category.id : '',
      }));

      setPreviewData(dataWithCategories);
      setPreviewTotal(Number.isFinite(Number(response.data?.totalRows))
        ? Number(response.data.totalRows)
        : dataWithCategories.length);
      setSaveError('');
      setStep(2);
    } catch {
      setPreviewError('הקובץ לא פוענח. ודאו שמבנה הקובץ מתאים לפרופיל שנבחר ונסו שוב.');
    } finally {
      setPreviewPending(false);
    }
  };

  const handleCategoryChange = (rowId, newCategoryId) => {
    setPreviewData((current) => current.map((row) => (
      row.id === rowId ? { ...row, category_id: newCategoryId } : row
    )));
    setSaveError('');
  };

  const closeNewCategoryModal = () => {
    if (categorySaving) return;
    setShowNewCategoryModal(false);
    setNewCategoryName('');
    setCategoryError('');
    setTargetRowId(null);
  };

  const handleSaveNewCategory = async () => {
    const name = newCategoryName.trim();
    if (!name || categorySaving) return;

    setCategorySaving(true);
    setCategoryError('');
    try {
      const response = await createCategory({ name });
      const newCategory = response.data;
      setCategories((current) => [...current, newCategory]);
      if (targetRowId !== null) handleCategoryChange(targetRowId, newCategory.id);
      setShowNewCategoryModal(false);
      setNewCategoryName('');
      setTargetRowId(null);
    } catch {
      setCategoryError('יצירת הקטגוריה נכשלה. השם נשמר ואפשר לנסות שוב.');
    } finally {
      setCategorySaving(false);
    }
  };

  const openNewCategoryModal = (rowId, categoryName = '') => {
    setTargetRowId(rowId);
    setNewCategoryName(categoryName);
    setCategoryError('');
    setShowNewCategoryModal(true);
  };

  const handleDeleteRow = (rowId) => {
    setPreviewData((current) => current.filter((row) => row.id !== rowId));
    setSaveError('');
  };

  const saveRows = async () => {
    if (saving || savableRows.length === 0) return false;

    setSaving(true);
    setSaveError('');
    try {
      await saveImportedTransactions(savableRows, selectedPaymentSourceId);
      toast.success({ message: `${savableRows.length} תנועות נשמרו בהצלחה.` });
      navigate('/');
      return true;
    } catch {
      setSaveError('שמירת התנועות נכשלה. התצוגה, הסיווגים והשורות שהוסרו נשמרו ואפשר לנסות שוב.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const requestSave = () => {
    if (saving || savableRows.length === 0) return;
    if (uncategorizedSaveCount > 0) {
      setShowUncategorizedConfirm(true);
      return;
    }
    saveRows();
  };

  const confirmUncategorizedSave = async () => {
    const saved = await saveRows();
    if (saved) setShowUncategorizedConfirm(false);
    return saved;
  };

  const backToSetup = () => {
    if (saving) return;
    setStep(1);
    setSaveError('');
    setShowUncategorizedConfirm(false);
  };

  const paymentSourceError = setupTouched && !selectedPaymentSourceId
    ? 'יש לבחור אמצעי תשלום לשיוך התנועות'
    : '';
  const fileError = fileTypeError || (setupTouched && !file ? 'יש לבחור קובץ לייבוא' : '');

  return (
    <div className={`import-page${step === 2 ? ' import-page--preview' : ''}`} dir="rtl">
      <Link ref={categoryReturnFocusRef} className="import-back-link" to="/add">
        <ArrowRight size={17} aria-hidden="true" />
        חזרה להוספה ידנית
      </Link>

      <ImportStepper step={step} />

      {referenceLoading && <ImportSetupSkeleton />}

      {!referenceLoading && referenceError && (
        <ErrorState
          level="page"
          title="טעינת נתוני הייבוא נכשלה"
          description="לא ניתן לטעון כרגע את הקטגוריות ואמצעי התשלום הדרושים לייבוא."
          retryLabel="נסה שוב"
          onRetry={loadReferenceData}
        />
      )}

      {!referenceLoading && !referenceError && step === 1 && (
        <section className="import-setup" aria-label="הכנת קובץ לייבוא">
          <div className="import-setup__grid">
            <Select
              id="import-profile"
              label="פרופיל ייבוא"
              helperText="המערכת אינה מזהה דפי חשבון אוטומטית. יש לבחור פרופיל קיים."
              required
              value={profile}
              disabled={previewPending}
              onValueChange={setProfile}
            >
              {IMPORT_PROFILES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>

            <Select
              id="import-payment-source"
              label="אמצעי תשלום"
              helperText={paymentSources.length
                ? 'כל התנועות בקובץ ישויכו לאמצעי התשלום הזה.'
                : 'לא נמצאו אמצעי תשלום פעילים.'}
              error={paymentSourceError}
              required
              value={selectedPaymentSourceId}
              disabled={previewPending || paymentSources.length === 0}
              onValueChange={setSelectedPaymentSourceId}
            >
              {paymentSources.map((paymentSource) => (
                <option key={paymentSource.id} value={paymentSource.id}>
                  {paymentSource.name}{paymentSource.last4 ? ` (${paymentSource.last4})` : ''}
                </option>
              ))}
            </Select>
          </div>

          <FileUpload
            id="import-file"
            className="import-file-upload"
            label="קובץ תנועות"
            helperText="הקובץ נשלח לשרת ומפוענח לפי הפרופיל שנבחר."
            error={fileError}
            required
            accept=".csv,.xls,.xlsx"
            files={file ? [file] : []}
            disabled={previewPending}
            dropLabel="גרירת קובץ לכאן או בחירה מהמחשב"
            selectLabel={file ? 'החלפת קובץ' : 'בחירת קובץ'}
            onFilesChange={handleFilesChange}
          />

          {previewPending && (
            <Alert className="import-processing" variant="info" title="מעלה ומפענח את הקובץ…" announce>
              הקובץ מועלה לשרת, ושם נקראות ומנורמלות שורות התנועות. אין צורך לסגור את העמוד.
            </Alert>
          )}

          {previewError && (
            <Alert
              variant="error"
              title="פענוח הקובץ נכשל"
              urgent
              onDismiss={() => setPreviewError('')}
            >
              {previewError}
            </Alert>
          )}

          <div className="import-setup__actions">
            <PrimaryButton
              type="button"
              size="lg"
              loading={previewPending}
              loadingText="מעלה ומעבד…"
              disabled={!file || Boolean(fileTypeError) || !profile || !selectedPaymentSourceId}
              onClick={handleUpload}
            >
              המשך לבדיקת התנועות
              <ArrowLeft size={17} aria-hidden="true" />
            </PrimaryButton>
          </div>
        </section>
      )}

      {!referenceLoading && !referenceError && step === 2 && (
        <ImportPreview
          rows={previewData}
          totalRows={previewTotal}
          categories={categories}
          fileName={file?.name || ''}
          saving={saving}
          saveError={saveError}
          onDismissError={() => setSaveError('')}
          onCategoryChange={handleCategoryChange}
          onCreateCategory={openNewCategoryModal}
          onRemove={handleDeleteRow}
          onBack={backToSetup}
          onSave={requestSave}
        />
      )}

      <Dialog
        open={showNewCategoryModal}
        onClose={closeNewCategoryModal}
        title="קטגוריה חדשה"
        description="הקטגוריה תיווצר ותשויך לשורה שנבחרה."
        size="sm"
        className="import-category-dialog"
        initialFocusRef={newCategoryInputRef}
        returnFocusRef={categoryReturnFocusRef}
        closeDisabled={categorySaving}
        footer={(
          <>
            <SecondaryButton type="button" disabled={categorySaving} onClick={closeNewCategoryModal}>
              ביטול
            </SecondaryButton>
            <PrimaryButton
              type="button"
              loading={categorySaving}
              loadingText="יוצר ומשייך…"
              disabled={!newCategoryName.trim()}
              onClick={handleSaveNewCategory}
            >
              יצירה ושיוך
            </PrimaryButton>
          </>
        )}
      >
        <div className="import-category-dialog__body">
          <span className="import-category-dialog__icon" aria-hidden="true">
            <FileSpreadsheet size={20} />
          </span>
          <TextField
            ref={newCategoryInputRef}
            id="import-new-category"
            label="שם הקטגוריה"
            placeholder="למשל: כלי עבודה"
            required
            value={newCategoryName}
            disabled={categorySaving}
            onValueChange={setNewCategoryName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSaveNewCategory();
              }
            }}
          />
          {categoryError && <Alert variant="error" urgent>{categoryError}</Alert>}
        </div>
      </Dialog>

      <ConfirmDialog
        open={showUncategorizedConfirm}
        title="שמירה עם תנועות לא מסווגות"
        message={`${uncategorizedSaveCount} תנועות יישמרו ללא קטגוריה. ניתן לסווג אותן מאוחר יותר במסך התנועות.`}
        confirmLabel="שמירה בכל זאת"
        cancelLabel="חזרה לסיווג"
        variant="warning"
        loading={saving}
        error={saveError}
        closeOnConfirm={false}
        onClose={() => {
          if (!saving) setShowUncategorizedConfirm(false);
        }}
        onConfirm={confirmUncategorizedSave}
      />
    </div>
  );
};

export default Import;
