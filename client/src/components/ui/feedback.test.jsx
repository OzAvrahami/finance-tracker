import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Alert from './Alert';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import ToastProvider from './ToastProvider';
import useToast from './useToast';

const ToastControls = () => {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.success({ message: 'נשמר בהצלחה', title: 'הצלחה' })}>הצלחה</button>
      <button type="button" onClick={() => toast.error({ message: 'שמירה נכשלה', urgent: true, persistent: true })}>שגיאה</button>
      <button type="button" onClick={() => toast.info({ message: 'הודעת מידע' })}>מידע</button>
      <button type="button" onClick={() => toast.warning({ message: 'אזהרה' })}>אזהרה</button>
      <button type="button" onClick={() => toast.show({ id: 'stable', message: 'גרסה ראשונה' })}>כפילות א</button>
      <button type="button" onClick={() => toast.show({ id: 'stable', message: 'גרסה שנייה' })}>כפילות ב</button>
      <button
        type="button"
        onClick={() => toast.info({
          message: 'אפשר לבטל',
          action: { label: 'ביטול', onClick: () => {} },
        })}
      >
        פעולה
      </button>
    </>
  );
};

const renderToasts = () => render(
  <ToastProvider>
    <ToastControls />
  </ToastProvider>,
);

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastProvider', () => {
  it('announces success politely and urgent errors assertively', async () => {
    const user = userEvent.setup();
    renderToasts();
    await user.click(screen.getByRole('button', { name: 'הצלחה' }));
    const success = screen.getByRole('status');
    expect(success).toHaveAttribute('aria-live', 'polite');
    expect(success).toHaveTextContent('נשמר בהצלחה');

    await user.click(screen.getByRole('button', { name: 'שגיאה' }));
    const error = screen.getByRole('alert');
    expect(error).toHaveAttribute('aria-live', 'assertive');
    expect(error).toHaveTextContent('שמירה נכשלה');
  });

  it('queues multiple visible transient messages', async () => {
    const user = userEvent.setup();
    renderToasts();
    await user.click(screen.getByRole('button', { name: 'מידע' }));
    await user.click(screen.getByRole('button', { name: 'אזהרה' }));
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getByLabelText('הודעות זמניות')).toBeInTheDocument();
  });

  it('manually dismisses a toast with an accessible close control', async () => {
    const user = userEvent.setup();
    renderToasts();
    await user.click(screen.getByRole('button', { name: 'מידע' }));
    await user.click(screen.getByRole('button', { name: 'סגירת הודעה' }));
    expect(screen.queryByText('הודעת מידע')).not.toBeInTheDocument();
  });

  it('automatically dismisses non-persistent messages', () => {
    vi.useFakeTimers();
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'הצלחה' }));
    expect(screen.getByText('נשמר בהצלחה')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4500));
    expect(screen.queryByText('נשמר בהצלחה')).not.toBeInTheDocument();
  });

  it('keeps an explicitly persistent blocking error visible', () => {
    vi.useFakeTimers();
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'שגיאה' }));
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByText('שמירה נכשלה')).toBeInTheDocument();
  });

  it('pauses automatic dismissal while hovered and resumes afterward', () => {
    vi.useFakeTimers();
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'הצלחה' }));
    const toast = screen.getByRole('status');
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByText('נשמר בהצלחה')).toBeInTheDocument();
    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(4500));
    expect(screen.queryByText('נשמר בהצלחה')).not.toBeInTheDocument();
  });

  it('pauses automatic dismissal while focus remains within the toast', () => {
    vi.useFakeTimers();
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'פעולה' }));
    const action = screen.getByRole('button', { name: 'ביטול' });
    fireEvent.focus(action);
    act(() => vi.advanceTimersByTime(9000));
    expect(screen.getByText('אפשר לבטל')).toBeInTheDocument();
    fireEvent.blur(action, { relatedTarget: null });
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText('אפשר לבטל')).not.toBeInTheDocument();
  });

  it('updates a stable duplicate ID instead of creating duplicate toasts', async () => {
    const user = userEvent.setup();
    renderToasts();
    await user.click(screen.getByRole('button', { name: 'כפילות א' }));
    await user.click(screen.getByRole('button', { name: 'כפילות ב' }));
    expect(screen.queryByText('גרסה ראשונה')).not.toBeInTheDocument();
    expect(screen.getAllByText('גרסה שנייה')).toHaveLength(1);
  });
});

describe('Alert', () => {
  it.each(['info', 'success', 'warning', 'error'])('renders the %s semantic color variant', (variant) => {
    render(<Alert variant={variant} title="כותרת">תוכן</Alert>);
    expect(screen.getByText('כותרת').closest('.ui-alert')).toHaveClass(`ui-alert--${variant}`);
  });

  it('uses an assertive alert role only when explicitly urgent', () => {
    const { rerender } = render(<Alert variant="error">שגיאה רגילה</Alert>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(<Alert variant="error" urgent>שגיאה דחופה</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('שגיאה דחופה');
  });

  it('supports actions and dismissal', async () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <Alert action={<button type="button" onClick={onAction}>נסה שוב</button>} onDismiss={onDismiss}>
        הודעה
      </Alert>,
    );
    await user.click(screen.getByRole('button', { name: 'נסה שוב' }));
    await user.click(screen.getByRole('button', { name: 'סגירת הודעה' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('EmptyState and ErrorState', () => {
  it('distinguishes filtered, dataset, compact, and full empty states', () => {
    const { rerender } = render(<EmptyState variant="filtered" size="compact" title="אין התאמות" />);
    expect(screen.getByText('אין התאמות').closest('section'))
      .toHaveClass('ui-empty-state--filtered', 'ui-empty-state--compact');
    rerender(<EmptyState variant="dataset" size="full" title="אין נתונים" />);
    expect(screen.getByText('אין נתונים').closest('section'))
      .toHaveAttribute('data-empty-variant', 'dataset');
  });

  it('renders optional empty-state actions without embedding route behavior', async () => {
    const action = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="אין פריטים"
        primaryAction={<button type="button" onClick={action}>הוספה</button>}
        secondaryAction={<button type="button">איפוס</button>}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'הוספה' }));
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'איפוס' })).toBeInTheDocument();
  });

  it('exposes page, section, and inline error levels with deliberate technical details', () => {
    const { rerender } = render(
      <ErrorState level="page" title="טעינה נכשלה" technicalDetails="request-id: abc-123" />,
    );
    expect(screen.getByText('טעינה נכשלה').closest('section')).toHaveClass('ui-error-state--page');
    expect(screen.getByText('request-id: abc-123')).toHaveAttribute('dir', 'ltr');
    rerender(<ErrorState level="inline" title="שגיאה בשדה" />);
    expect(screen.getByText('שגיאה בשדה').closest('section')).toHaveClass('ui-error-state--inline');
  });

  it('shows retry loading state and prevents repeated retry calls', async () => {
    let resolveRetry;
    const retryPromise = new Promise((resolve) => { resolveRetry = resolve; });
    const onRetry = vi.fn(() => retryPromise);
    const user = userEvent.setup();
    render(<ErrorState title="טעינה נכשלה" onRetry={onRetry} />);
    const retry = screen.getByRole('button', { name: 'ניסיון נוסף' });
    await user.click(retry);
    expect(retry).toBeDisabled();
    await user.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
    await act(async () => {
      resolveRetry();
      await retryPromise;
    });
  });

  it('supports an optional secondary error action and urgent announcement', () => {
    render(
      <ErrorState
        title="לא ניתן להמשיך"
        urgent
        secondaryAction={<button type="button">חזרה</button>}
      />,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByRole('button', { name: 'חזרה' })).toBeInTheDocument();
  });
});
