import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Dialog from './Dialog';
import ConfirmDialog from './ConfirmDialog';
import BottomSheet from './BottomSheet';
import Drawer from './Drawer';

afterEach(() => {
  document.body.style.overflow = '';
});

const DialogHarness = ({ initialFocus = false }) => {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>פתיחה</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="כותרת דיאלוג"
        description="תיאור הדיאלוג"
        initialFocusRef={initialFocus ? inputRef : undefined}
        footer={<button type="button">פעולת סיום</button>}
      >
        <input ref={inputRef} aria-label="שדה בדיקה" />
        <button type="button">פעולה פנימית</button>
      </Dialog>
    </>
  );
};

describe('shared overlay foundation and Dialog', () => {
  it('renders through a body portal with associated title and description', () => {
    const host = document.createElement('div');
    document.body.append(host);
    render(
      <Dialog open onClose={() => {}} title="פרטי הרשומה" description="מידע נוסף">
        תוכן
      </Dialog>,
      { container: host },
    );

    const dialog = screen.getByRole('dialog', { name: 'פרטי הרשומה' });
    expect(host).not.toContainElement(dialog);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', screen.getByText('פרטי הרשומה').id);
    expect(dialog).toHaveAttribute('aria-describedby', screen.getByText('מידע נוסף').id);
  });

  it('honors a custom initial-focus target', async () => {
    const user = userEvent.setup();
    render(<DialogHarness initialFocus />);
    await user.click(screen.getByRole('button', { name: 'פתיחה' }));
    expect(screen.getByRole('textbox', { name: 'שדה בדיקה' })).toHaveFocus();
  });

  it('contains Tab and Shift+Tab focus within the panel', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole('button', { name: 'פתיחה' }));

    const close = screen.getByRole('button', { name: 'סגירה' });
    const last = screen.getByRole('button', { name: 'פעולת סיום' });
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it('dismisses with Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'פתיחה' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('supports disabling Escape dismissal', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Dialog open onClose={onClose} title="נעול" dismissOnEscape={false}>תוכן</Dialog>);
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dismisses through the backdrop but not through an inside click', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Dialog open onClose={onClose} title="בדיקה"><button type="button">בפנים</button></Dialog>);

    await user.click(screen.getByRole('button', { name: 'בפנים' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'סגירת חלון' }));
    expect(onClose).toHaveBeenCalledWith('backdrop');
  });

  it('supports disabling backdrop dismissal', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Dialog open onClose={onClose} title="נעול" dismissOnBackdrop={false}>תוכן</Dialog>);
    expect(screen.queryByRole('button', { name: 'סגירת חלון' })).not.toBeInTheDocument();
    await user.click(document.querySelector('.ui-overlay-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks scrolling until the final overlay closes', () => {
    document.body.style.overflow = 'clip';
    const { rerender } = render(
      <>
        <Dialog open onClose={() => {}} title="ראשון">א</Dialog>
        <Dialog open onClose={() => {}} title="שני">ב</Dialog>
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Dialog open onClose={() => {}} title="ראשון">א</Dialog>);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Dialog open={false} onClose={() => {}} title="ראשון">א</Dialog>);
    expect(document.body.style.overflow).toBe('clip');
  });

  it('lets only the top-most overlay respond to Escape', () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    render(
      <>
        <Dialog open onClose={closeFirst} title="ראשון">א</Dialog>
        <Dialog open onClose={closeSecond} title="שני">ב</Dialog>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeSecond).toHaveBeenCalledWith('escape');
    expect(closeFirst).not.toHaveBeenCalled();
  });

  it('returns focus to the nested trigger while the underlying overlay stays locked', async () => {
    const user = userEvent.setup();
    const NestedHarness = () => {
      const [nestedOpen, setNestedOpen] = useState(false);
      return (
        <Dialog open onClose={() => {}} title="דיאלוג בסיס">
          <button type="button" onClick={() => setNestedOpen(true)}>פתיחת דיאלוג נוסף</button>
          <Dialog open={nestedOpen} onClose={() => setNestedOpen(false)} title="דיאלוג עליון">
            תוכן עליון
          </Dialog>
        </Dialog>
      );
    };
    render(<NestedHarness />);
    const nestedTrigger = screen.getByRole('button', { name: 'פתיחת דיאלוג נוסף' });
    await user.click(nestedTrigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'דיאלוג עליון' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'דיאלוג בסיס' })).toBeInTheDocument();
    expect(nestedTrigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('exposes the close button, footer actions, disabled state, and mobile-width class', () => {
    render(
      <Dialog
        open
        onClose={() => {}}
        title="פעולות"
        footer={<button type="button" disabled aria-busy="true">שומר</button>}
      >
        תוכן
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'סגירה' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שומר' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'שומר' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('dialog')).toHaveClass('ui-dialog--mobile-full');
  });
});

describe('ConfirmDialog', () => {
  it('gives the safe action initial focus and Enter never confirms by default', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title="מחיקה" message="למחוק?" variant="destructive" />,
    );
    expect(screen.getByRole('button', { name: 'ביטול' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith('cancelled');
  });

  it('runs confirmation once while an asynchronous action is pending', async () => {
    let resolveConfirm;
    const pending = new Promise((resolve) => { resolveConfirm = resolve; });
    const onConfirm = vi.fn(() => pending);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="אישור"
        message="להמשיך?"
        confirmLabel="המשך"
      />,
    );

    const confirm = screen.getByRole('button', { name: 'המשך' });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    await act(async () => {
      resolveConfirm();
      await pending;
    });
    expect(onClose).toHaveBeenCalledWith('confirmed');
  });

  it('keeps the dialog open and shows a safe error when async confirmation fails', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => Promise.reject(new Error('private server detail'))}
        title="אישור"
        message="להמשיך?"
        errorMessage="לא ניתן להשלים את הפעולה"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'אישור' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('לא ניתן להשלים את הפעולה');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
  });

  it('applies destructive semantics and custom labels', () => {
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="השבתה"
        message="האם להשבית?"
        variant="destructive"
        confirmLabel="השבתה"
        cancelLabel="שמירה"
      />,
    );
    expect(screen.getByRole('dialog')).toHaveClass('ui-confirm-dialog--destructive');
    expect(screen.getByRole('button', { name: 'השבתה' })).toHaveClass('ui-btn-destructive');
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeInTheDocument();
  });
});

describe('BottomSheet and Drawer', () => {
  it('provides BottomSheet dialog semantics and sticky safe-area footer classes', () => {
    render(
      <BottomSheet open onClose={() => {}} title="מסננים" stickyFooter footer={<button type="button">החלה</button>}>
        תוכן מסננים
      </BottomSheet>,
    );
    expect(screen.getByRole('dialog', { name: 'מסננים' })).toHaveClass('ui-bottom-sheet');
    expect(document.querySelector('.ui-bottom-sheet-handle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'החלה' }).parentElement).toHaveClass('is-sticky');
  });

  it.each(['start', 'end'])('supports the RTL-logical Drawer %s side', (side) => {
    render(<Drawer open onClose={() => {}} title="מגירה" side={side}>תוכן</Drawer>);
    expect(screen.getByRole('dialog', { name: 'מגירה' })).toHaveClass(`ui-drawer--${side}`);
  });

  it('returns Drawer focus after Escape', async () => {
    const user = userEvent.setup();
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>פתיחת מגירה</button>
          <Drawer open={open} onClose={() => setOpen(false)} title="מגירה">תוכן</Drawer>
        </>
      );
    };
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'פתיחת מגירה' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
});
