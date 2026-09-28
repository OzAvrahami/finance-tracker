import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import FlowlinkBindingsTab from './FlowlinkBindingsTab';
import { createFlowlinkBinding, createFlowlinkPairing, cancelFlowlinkPairing, getFlowlinkBindings, getFlowlinkDevices, getFlowlinkPaymentSources, updateFlowlinkBinding } from '../../services/api';
vi.mock('../../services/api', () => ({ createFlowlinkPairing: vi.fn(), cancelFlowlinkPairing: vi.fn(), createFlowlinkBinding: vi.fn(), getFlowlinkBindings: vi.fn(), getFlowlinkDevices: vi.fn(), getFlowlinkPaymentSources: vi.fn(), updateFlowlinkBinding: vi.fn() }));
const device = { id: '11111111-1111-4111-8111-111111111111', label: 'My phone', status: 'active' };
const card = { id: '9223372036854775806', name: 'Explicit card', last4: '1234' };
const binding = { id: '22222222-2222-4222-8222-222222222222', device_id: device.id, label: 'My binding', payment_source_id: card.id, status: 'active', revision: '1' };
beforeEach(() => {
  vi.resetAllMocks();
  getFlowlinkDevices.mockResolvedValue({ data: { devices: [device], next_cursor: null } });
  getFlowlinkPaymentSources.mockResolvedValue({ data: { payment_sources: [card], next_cursor: null } });
  getFlowlinkBindings.mockResolvedValue({ data: { bindings: [binding], next_cursor: null } });
  createFlowlinkBinding.mockResolvedValue({ data: binding });updateFlowlinkBinding.mockResolvedValue({ data: { ...binding, revision: '2' } });
});
async function selectDevice() {
  const user = userEvent.setup();render(<FlowlinkBindingsTab />);
  await user.selectOptions(await screen.findByLabelText('מכשיר FlowLink'), device.id);
  await screen.findByRole('article', { name: 'My binding' });return user;
}
it('requires explicit device and payment-source selection, preserving decimal IDs', async () => {
  const user = await selectDevice();
  expect(screen.getByRole('combobox', { name: /אמצעי תשלום לשיוך/ })).toHaveValue('');
  expect(screen.getByRole('button', { name: 'יצירת שיוך' })).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: /שם השיוך/ }), 'Second card');
  await user.selectOptions(screen.getByRole('combobox', { name: /אמצעי תשלום לשיוך/ }), card.id);
  await user.click(screen.getByRole('button', { name: 'יצירת שיוך' }));
  await waitFor(() => expect(createFlowlinkBinding).toHaveBeenCalledTimes(1));
  expect(createFlowlinkBinding.mock.calls[0]).toEqual([device.id, { request_id: expect.any(String), label: 'Second card', payment_source_id: card.id }]);
});
it('disables and re-enables with the displayed revision and confirms terminal retirement', async () => {
  const user = await selectDevice();
  getFlowlinkBindings.mockResolvedValue({ data: { bindings: [{ ...binding, status: 'disabled', revision: '2' }], next_cursor: null } });
  await user.click(screen.getByRole('button', { name: 'השבתה' }));
  await waitFor(() => expect(updateFlowlinkBinding).toHaveBeenCalledWith(binding.id, expect.objectContaining({ expected_revision: '1', status: 'disabled' })));
  await user.click(await screen.findByRole('button', { name: 'הפעלה מחדש' }));
  await waitFor(() => expect(updateFlowlinkBinding).toHaveBeenCalledWith(binding.id, expect.objectContaining({ expected_revision: '2', status: 'active' })));
  await user.click(screen.getByRole('button', { name: 'הוצאה משימוש' }));
  const dialog = await screen.findByRole('dialog');expect(within(dialog).getByText(/זו פעולה סופית/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'הוצאה משימוש' }));
  await waitFor(() => expect(updateFlowlinkBinding).toHaveBeenCalledWith(binding.id, expect.objectContaining({ status: 'retired' })));
});
it('uncertain response retries the identical frozen command and locks selections', async () => {
  const user = await selectDevice();updateFlowlinkBinding.mockRejectedValueOnce(new Error('network'));
  await user.click(screen.getByRole('button', { name: 'השבתה' }));
  const retry = await screen.findByRole('button', { name: 'ניסיון חוזר לאותה פעולה' });
  await waitFor(() => expect(retry).toBeEnabled());expect(screen.getByLabelText('מכשיר FlowLink')).toBeDisabled();
  await user.click(retry);await waitFor(() => expect(updateFlowlinkBinding).toHaveBeenCalledTimes(2));
  expect(updateFlowlinkBinding.mock.calls[0]).toEqual(updateFlowlinkBinding.mock.calls[1]);
});
it('unapproved user sees an accessible permission message and no mutation controls', async () => {
  getFlowlinkDevices.mockRejectedValue({ response: { status: 403 } });render(<FlowlinkBindingsTab />);
  expect(await screen.findByText('ניהול FlowLink זמין רק לבעלי הרשאה.')).toBeInTheDocument();
  expect(screen.queryByLabelText('מכשיר FlowLink')).not.toBeInTheDocument();expect(createFlowlinkBinding).not.toHaveBeenCalled();
});
it('follows all list pages and does not offer retired bindings for reactivation', async () => {
  getFlowlinkDevices.mockResolvedValueOnce({ data: { devices: [], next_cursor: 'next-device' } }).mockResolvedValue({ data: { devices: [device], next_cursor: null } });
  getFlowlinkBindings.mockResolvedValueOnce({ data: { bindings: [], next_cursor: 'next-binding' } }).mockResolvedValue({ data: { bindings: [{ ...binding, status: 'retired' }], next_cursor: null } });
  await selectDevice();expect(getFlowlinkDevices).toHaveBeenCalledWith('next-device');expect(getFlowlinkBindings).toHaveBeenCalledWith(device.id, 'next-binding');
  expect(screen.getByText('הוצא משימוש')).toBeInTheDocument();expect(screen.queryByRole('button', { name: 'הפעלה מחדש' })).not.toBeInTheDocument();
});
it('a revoked device retains history but cannot create or re-enable a binding', async () => {
  getFlowlinkDevices.mockResolvedValue({ data: { devices: [{ ...device, status: 'revoked' }], next_cursor: null } });
  getFlowlinkBindings.mockResolvedValue({ data: { bindings: [{ ...binding, status: 'disabled' }], next_cursor: null } });
  await selectDevice();expect(screen.queryByRole('button', { name: 'יצירת שיוך' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'הפעלה מחדש' })).toBeDisabled();
});

it('owner can open QR onboarding without choosing a payment source or using developer tools', async () => {
  const user = userEvent.setup(); render(<FlowlinkBindingsTab />);
  await user.click(await screen.findByRole('button', { name: 'חיבור iPhone חדש' }));
  await user.type(screen.getByLabelText(/שם המכשיר/), 'Noya iPhone');
  createFlowlinkPairing.mockResolvedValue({ data: { pairing_id: 'pair', pairing_text: `flpair1.11111111-1111-4111-8111-111111111111.${'A'.repeat(43)}`, expires_at: new Date(Date.now() + 600000).toISOString() } });
  cancelFlowlinkPairing.mockResolvedValue({});
  await user.click(screen.getByRole('button', { name: 'יצירת QR' }));
  await screen.findByText('ממתינים לחיבור ה־iPhone…');
  expect(createFlowlinkPairing).toHaveBeenCalledWith({ purpose: 'enroll', label: 'Noya iPhone' });
  expect(createFlowlinkBinding).not.toHaveBeenCalled();
});

it('refreshes and selects the newly enrolled device with no inherited card choice', async () => {
  vi.useFakeTimers();
  try {
    await act(async () => render(<FlowlinkBindingsTab />));
    fireEvent.click(screen.getByRole('button', { name: 'חיבור iPhone חדש' }));
    fireEvent.change(screen.getByLabelText(/שם המכשיר/), { target: { value: 'Noya iPhone' } });
    createFlowlinkPairing.mockResolvedValue({ data: { pairing_id: 'pair', pairing_text: `flpair1.11111111-1111-4111-8111-111111111111.${'A'.repeat(43)}`, expires_at: new Date(Date.now() + 600000).toISOString() } });
    cancelFlowlinkPairing.mockResolvedValue({});
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'יצירת QR' })));
    const enrolled = { id: 'new-device', label: 'Noya iPhone', status: 'active' };
    getFlowlinkDevices.mockResolvedValue({ data: { devices: [device, enrolled], next_cursor: null } });
    getFlowlinkBindings.mockResolvedValue({ data: { bindings: [], next_cursor: null } });
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('מכשיר FlowLink')).toHaveValue(enrolled.id);
    expect(getFlowlinkBindings).toHaveBeenCalledWith(enrolled.id, undefined);
    expect(screen.getByRole('combobox', { name: /אמצעי תשלום לשיוך/ })).toHaveValue('');
    expect(createFlowlinkBinding).not.toHaveBeenCalled();
  } finally { cleanup(); vi.useRealTimers(); }
});
