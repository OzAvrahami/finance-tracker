import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import QRCode from 'react-qr-code';
import FlowlinkPairingDialog from './FlowlinkPairingDialog';
import { createFlowlinkPairing, cancelFlowlinkPairing } from '../../services/api';
vi.mock('../../services/api', () => ({ createFlowlinkPairing: vi.fn(), cancelFlowlinkPairing: vi.fn() }));
const secret = `flpair1.11111111-1111-4111-8111-111111111111.${'A'.repeat(43)}`;
let refreshDevices, onConnected, onClose;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T09:00:00Z'));
  refreshDevices = vi.fn().mockResolvedValue([]); onConnected = vi.fn(); onClose = vi.fn();
  createFlowlinkPairing.mockReset().mockResolvedValue({ data: { pairing_id: 'pair-1', pairing_text: secret, expires_at: '2026-09-28T09:10:00Z' } });
  cancelFlowlinkPairing.mockReset().mockResolvedValue({});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue() } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
function mount() { return render(<FlowlinkPairingDialog {...{ refreshDevices, onConnected, onClose }} />); }
async function generate() {
  fireEvent.change(screen.getByLabelText(/שם המכשיר/), { target: { value: 'Noya iPhone' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'יצירת QR' })));
}
it('generates the exact capability as local SVG, keeps raw text hidden, and reveals/copies only on demand', async () => {
  mount(); await generate();
  expect(createFlowlinkPairing).toHaveBeenCalledWith({ purpose: 'enroll', label: 'Noya iPhone' });
  const renderedPath = document.querySelector('.flowlink-pairing__qr svg path:last-child').getAttribute('d');
  const reference = render(<QRCode value={secret} size={224} level="M" />);
  expect(renderedPath).toBe(reference.container.querySelector('path:last-child').getAttribute('d'));
  expect(screen.queryByText(secret)).not.toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText('10:00')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'לא מצליחים לסרוק?' }));
  expect(screen.getByText(secret)).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'העתקת קוד' })));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(secret);
});
it('rejects whitespace, card-like labels and existing active device names before issuing a capability', async () => {
  mount();
  for (const value of ['   ', '1234567890123456']) {
    fireEvent.change(screen.getByLabelText(/שם המכשיר/), { target: { value } });
    await act(async () => fireEvent.submit(screen.getByRole('button', { name: 'יצירת QR' }).closest('form')));
  }
  refreshDevices.mockResolvedValue([{ id: 'existing', label: 'Noya iPhone', status: 'active' }]);
  await generate(); expect(createFlowlinkPairing).not.toHaveBeenCalled();
});
it('removes QR and fallback on expiry and issues a replacement only after explicit action', async () => {
  mount(); await generate(); fireEvent.click(screen.getByRole('button', { name: 'לא מצליחים לסרוק?' }));
  await act(async () => vi.advanceTimersByTimeAsync(600000));
  expect(document.querySelector('.flowlink-pairing__qr')).toBeNull(); expect(screen.queryByText(secret)).not.toBeInTheDocument();
  expect(createFlowlinkPairing).toHaveBeenCalledTimes(1);
  createFlowlinkPairing.mockResolvedValue({ data: { pairing_id: 'pair-2', pairing_text: secret, expires_at: '2026-09-28T09:20:00Z' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'יצירת QR חדש' })));
  expect(cancelFlowlinkPairing).toHaveBeenCalledWith('pair-1');
  expect(createFlowlinkPairing).toHaveBeenCalledTimes(2); expect(screen.getByText('10:00')).toBeInTheDocument();
});
it('cancels unused pairing and refreshes devices on close', async () => {
  mount(); await generate();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ביטול' })));
  expect(cancelFlowlinkPairing).toHaveBeenCalledWith('pair-1'); expect(refreshDevices).toHaveBeenCalledTimes(2); expect(onClose).toHaveBeenCalledWith('');
});
it('treats consumed cancellation as a safe refresh, never revocation', async () => {
  mount(); await generate(); cancelFlowlinkPairing.mockRejectedValue({ response: { status: 409 } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ביטול' })));
  expect(refreshDevices).toHaveBeenCalledTimes(2); expect(onClose).toHaveBeenCalledWith('');
});
it('selects only a unique new active device matching the chosen label', async () => {
  mount(); await generate(); const connected = { id: 'new', label: 'Noya iPhone', status: 'active' };
  refreshDevices.mockResolvedValue([connected, { id: 'other', label: 'Other phone', status: 'active' }]);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(onConnected).toHaveBeenCalledExactlyOnceWith(connected);
});
it('does not guess between concurrent same-name devices', async () => {
  mount(); await generate();
  refreshDevices.mockResolvedValue(['one', 'two'].map(id => ({ id, label: 'Noya iPhone', status: 'active' })));
  await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(onConnected).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('נוספו כמה מכשירים');
});
it('cancels a late issuance response after navigation away', async () => {
  let resolve; createFlowlinkPairing.mockImplementation(() => new Promise(r => { resolve = r; }));
  const view = mount(); await generate(); view.unmount();
  await act(async () => resolve({ data: { pairing_id: 'late' } }));
  expect(cancelFlowlinkPairing).toHaveBeenCalledWith('late'); expect(onConnected).not.toHaveBeenCalled();
});
it('reports an uncertain cancel honestly and does not issue a replacement automatically', async () => {
  mount(); await generate(); cancelFlowlinkPairing.mockRejectedValue(new Error('offline'));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ביטול' })));
  expect(onClose).toHaveBeenCalledWith(expect.stringContaining('יפוג אוטומטית')); expect(createFlowlinkPairing).toHaveBeenCalledTimes(1);
});
