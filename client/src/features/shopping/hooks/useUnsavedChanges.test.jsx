import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmDiscard, useUnsavedChanges } from './useUnsavedChanges';

function Drafts({ dirty }) {
  useUnsavedChanges(dirty);
  useUnsavedChanges(dirty);
  // Avoid jsdom navigation; real beforeunload behavior is covered in Chromium.
  return <a href="/settings" onClick={event => event.preventDefault()}>Settings</a>;
}
afterEach(() => vi.restoreAllMocks());
describe('unsaved preview navigation', () => {
  it('does not stack custom link confirmations for multiple drafts', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Drafts dirty />);
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(confirm).not.toHaveBeenCalled();
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
  });
  it('removes leave protection once the drafts are clean', () => {
    const { rerender } = render(<Drafts dirty />);
    rerender(<Drafts dirty={false} />);
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
  });
  it('still requires explicit confirmation when discarding an edited dialog', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmDiscard(true)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirmDiscard(false)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
