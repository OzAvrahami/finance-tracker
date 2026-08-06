import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tabs, TabList, Tab, TabPanel } from './Tabs';
import SegmentedControl from './SegmentedControl';

const UncontrolledTabs = ({ direction = 'rtl', orientation = 'horizontal' }) => (
  <Tabs defaultValue="first" direction={direction} orientation={orientation}>
    <TabList aria-label="מדורים">
      <Tab value="first" badge={2}>ראשון</Tab>
      <Tab value="disabled" disabled>מושבת</Tab>
      <Tab value="last">אחרון</Tab>
    </TabList>
    <TabPanel value="first">תוכן ראשון</TabPanel>
    <TabPanel value="disabled">תוכן מושבת</TabPanel>
    <TabPanel value="last">תוכן אחרון</TabPanel>
  </Tabs>
);

describe('Tabs', () => {
  it('associates tab and panel roles and changes uncontrolled selection', async () => {
    const user = userEvent.setup();
    render(<UncontrolledTabs />);
    const first = screen.getByRole('tab', { name: /^ראשון/ });
    const last = screen.getByRole('tab', { name: 'אחרון' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('תוכן ראשון');
    expect(first).toHaveAttribute('aria-controls', screen.getByText('תוכן ראשון').id);
    await user.click(last);
    expect(last).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('תוכן אחרון');
  });

  it('uses roving tabIndex and skips disabled tabs with RTL arrow behavior', async () => {
    const user = userEvent.setup();
    render(<UncontrolledTabs />);
    const first = screen.getByRole('tab', { name: /^ראשון/ });
    const last = screen.getByRole('tab', { name: 'אחרון' });
    first.focus();
    await user.keyboard('{ArrowLeft}');
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'מושבת' })).toBeDisabled();
  });

  it('maps physical ArrowRight correctly in RTL visual order', async () => {
    const user = userEvent.setup();
    render(<UncontrolledTabs />);
    const first = screen.getByRole('tab', { name: /^ראשון/ });
    const last = screen.getByRole('tab', { name: 'אחרון' });
    last.focus();
    await user.keyboard('{ArrowRight}');
    expect(first).toHaveFocus();
  });

  it('supports Home, End, and vertical arrow navigation', async () => {
    const user = userEvent.setup();
    render(<UncontrolledTabs orientation="vertical" />);
    const first = screen.getByRole('tab', { name: /^ראשון/ });
    const last = screen.getByRole('tab', { name: 'אחרון' });
    first.focus();
    await user.keyboard('{End}');
    expect(last).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(last).toHaveFocus();
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('supports controlled selection without mutating the caller value', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Tabs value="a" onValueChange={onValueChange}>
        <TabList aria-label="מבוקר"><Tab value="a">א</Tab><Tab value="b">ב</Tab></TabList>
        <TabPanel value="a">אחד</TabPanel><TabPanel value="b">שתיים</TabPanel>
      </Tabs>,
    );
    await user.click(screen.getByRole('tab', { name: 'ב' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tab', { name: 'א' })).toHaveAttribute('aria-selected', 'true');
  });
});

const segments = [
  { value: 'month', label: 'חודש' },
  { value: 'quarter', label: 'רבעון', disabled: true },
  { value: 'year', label: 'שנה' },
];

describe('SegmentedControl', () => {
  it('uses single-selection radio-group semantics', () => {
    render(<SegmentedControl label="תקופה" value="month" options={segments} onValueChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'תקופה' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'חודש' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'רבעון' })).toBeDisabled();
  });

  it('supports controlled selection callbacks', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(<SegmentedControl label="תקופה" value="month" options={segments} onValueChange={onValueChange} />);
    await user.click(screen.getByRole('radio', { name: 'שנה' }));
    expect(onValueChange).toHaveBeenCalledWith('year');
    expect(screen.getByRole('radio', { name: 'חודש' })).toHaveAttribute('aria-checked', 'true');
  });

  it('skips disabled options during RTL keyboard operation', async () => {
    const Harness = () => {
      const [value, setValue] = useState('month');
      return <SegmentedControl label="תקופה" value={value} options={segments} onValueChange={setValue} />;
    };
    const user = userEvent.setup();
    render(<Harness />);
    const month = screen.getByRole('radio', { name: 'חודש' });
    month.focus();
    await user.keyboard('{ArrowLeft}');
    const year = screen.getByRole('radio', { name: 'שנה' });
    expect(year).toHaveFocus();
    expect(year).toHaveAttribute('aria-checked', 'true');
  });

  it('supports Home/End plus compact and full-width presentation', async () => {
    const user = userEvent.setup();
    render(
      <SegmentedControl
        label="תקופה"
        value="month"
        options={segments}
        onValueChange={() => {}}
        size="compact"
        fullWidth
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'תקופה' });
    expect(group).toHaveClass('ui-segmented--compact', 'ui-segmented--full');
    screen.getByRole('radio', { name: 'חודש' }).focus();
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'שנה' })).toHaveFocus();
  });
});
