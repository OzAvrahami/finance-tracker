import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import InstallmentProgress from './InstallmentProgress';

describe('InstallmentProgress', () => {
  it.each([
    [24, 36, '24 מתוך 36'],
    [25, 72, '25 מתוך 72'],
    [0, 60, '0 מתוך 60'],
  ])('isolates %s of %s from the surrounding RTL direction', (paid, total, expected) => {
    render(<div dir="rtl"><InstallmentProgress paid={paid} total={total} /></div>);

    const progress = screen.getByLabelText(expected);
    expect(progress).toHaveAttribute('dir', 'ltr');
    expect(progress).toHaveTextContent(expected);
    expect(progress.querySelectorAll('bdi')).toHaveLength(2);
  });
});
