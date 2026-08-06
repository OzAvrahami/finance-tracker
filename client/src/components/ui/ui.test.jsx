import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Card,
  GlassCard,
  IconButton,
  MoneyAmount,
  PrimaryButton,
  ProgressBar,
  Skeleton,
  TechnicalValue,
} from './index';

describe('TechnicalValue', () => {
  it('creates an inline semantic LTR isolation boundary', () => {
    render(
      <p>
        קובץ <TechnicalValue className="file-value" data-testid="value">report-2026.xlsx</TechnicalValue>
      </p>,
    );

    const value = screen.getByTestId('value');
    expect(value.tagName).toBe('BDI');
    expect(value).toHaveAttribute('dir', 'ltr');
    expect(value).toHaveClass('u-technical-ltr', 'file-value');
    expect(value).toHaveTextContent('report-2026.xlsx');
  });
});

describe('MoneyAmount', () => {
  it.each([
    { name: 'positive integer', value: 18450, props: {}, expected: '₪18,450' },
    { name: 'explicit positive sign', value: 18450, props: { signed: true }, expected: '+₪18,450' },
    { name: 'negative integer', value: -342, props: {}, expected: '−₪342' },
    { name: 'zero', value: 0, props: { signed: true }, expected: '₪0' },
    { name: 'positive decimal', value: '1234.50', props: {}, expected: '₪1,234.50' },
    { name: 'negative decimal', value: -19.75, props: {}, expected: '−₪19.75' },
    { name: 'large grouped value', value: 123456789, props: {}, expected: '₪123,456,789' },
  ])('renders $name without losing sign or precision', ({ value, props, expected }) => {
    render(<MoneyAmount value={value} {...props} />);

    const amount = screen.getByText(expected);
    expect(amount).toHaveAttribute('dir', 'ltr');
    expect(amount).toHaveClass('u-technical-ltr', 'num');
  });

  it('supports an explicit currency without converting the value', () => {
    render(<MoneyAmount value="42.25" currency="USD" />);
    expect(screen.getByText('$42.25')).toBeInTheDocument();
  });
});

describe('Button primitives', () => {
  it('disables and exposes a busy state while loading', () => {
    render(<PrimaryButton loading loadingText="שומר">שמירה</PrimaryButton>);

    const button = screen.getByRole('button', { name: 'שומר' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('data-loading', 'true');
    expect(button.querySelector('.ui-button-spinner')).toHaveAttribute('aria-hidden', 'true');
  });

  it('preserves native disabled and click behavior', () => {
    const onClick = vi.fn();
    const { rerender } = render(<PrimaryButton onClick={onClick}>המשך</PrimaryButton>);

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(<PrimaryButton onClick={onClick} disabled>המשך</PrimaryButton>);
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('supports full width without changing the default button type', () => {
    render(<PrimaryButton fullWidth>שמירה</PrimaryButton>);
    const button = screen.getByRole('button', { name: 'שמירה' });
    expect(button).toHaveStyle({ width: '100%' });
    expect(button).not.toHaveAttribute('type');
  });
});

describe('IconButton', () => {
  it('uses title as an accessible-name fallback', () => {
    render(<IconButton title="התראות"><span aria-hidden="true">!</span></IconButton>);
    expect(screen.getByRole('button', { name: 'התראות' })).toHaveAttribute('title', 'התראות');
  });

  it('supports the opt-in touch-friendly size', () => {
    render(<IconButton aria-label="פתיחה" size="touch">+</IconButton>);
    expect(screen.getByRole('button', { name: 'פתיחה' })).toHaveStyle({ width: '44px', height: '44px' });
  });

  it('rejects an icon-only button with no accessible name', () => {
    expect(() => render(<IconButton><span aria-hidden="true">!</span></IconButton>))
      .toThrow('IconButton requires title, aria-label, or aria-labelledby.');
  });
});

describe('ProgressBar', () => {
  it('exposes an accessible measurable range', () => {
    render(<ProgressBar value={35} max={80} label="ניצול תקציב" />);

    const progress = screen.getByRole('progressbar', { name: 'ניצול תקציב' });
    expect(progress).toHaveAttribute('aria-valuenow', '35');
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '80');
  });

  it('clamps only the visual fill for an over-maximum business value', () => {
    const { container } = render(<ProgressBar value={125} max={100} aria-label="חריגה" />);

    expect(screen.getByRole('progressbar', { name: 'חריגה' }))
      .toHaveAttribute('aria-valuenow', '125');
    expect(container.querySelector('[data-progress-fill]')).toHaveStyle({ width: '100%' });
  });
});

describe('Card and Skeleton primitives', () => {
  it('uses canonical Finance v3 card surfaces', () => {
    render(
      <>
        <Card data-testid="card">כרטיס</Card>
        <GlassCard data-testid="glass">זכוכית</GlassCard>
      </>,
    );

    expect(screen.getByTestId('card')).toHaveStyle({
      backgroundColor: 'var(--ft-surface-solid-secondary)',
      borderRadius: 'var(--ft-radius-xl)',
    });
    expect(screen.getByTestId('glass')).toHaveClass('ui-glass');
    expect(screen.getByTestId('glass')).toHaveStyle({ backgroundColor: 'var(--ft-glass)' });
  });

  it('keeps skeletons non-semantic and attached to the reduced-motion-compatible class', () => {
    render(<Skeleton data-testid="skeleton" width={120} height={20} />);
    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toHaveClass('ui-skeleton');
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    expect(skeleton).toHaveStyle({ width: '120px', height: '20px' });
  });
});
