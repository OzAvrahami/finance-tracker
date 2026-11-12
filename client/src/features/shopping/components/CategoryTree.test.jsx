import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CategoryTree from './CategoryTree';

function deep(depth) {
  return Array.from({ length: depth }, (_, i) => ({ id: String(i), parent_id: i ? String(i-1) : null, name: `node-${i}`, path: [{ id: String(i), name: `node-${i}` }],
    ancestor_ids: Array.from({ length: i }, (_, n) => String(n)), child_ids: i < depth-1 ? [String(i+1)] : [], effective_active: true, direct_count: 0 }));
}
describe('iterative tree presentation', () => {
  it('renders a depth-2000 search result with correct level without recursive components', () => {
    render(<CategoryTree categories={deep(2000)} search="node-1999" filter="active" onSelect={vi.fn()} />);
    expect(screen.getByRole('treeitem')).toHaveAttribute('aria-level', '2000');
  });
  it('starts collapsed, expands using RTL keyboard and navigates visible rows', () => {
    render(<CategoryTree categories={deep(3)} search="" filter="active" onSelect={vi.fn()} />);
    const root = screen.getByRole('treeitem'); act(() => root.focus());
    fireEvent.keyDown(root, { key: 'ArrowLeft' });
    expect(screen.getAllByRole('treeitem')).toHaveLength(2);
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    expect(screen.getByRole('treeitem', { name: /node-1/ })).toHaveFocus();
  });
  it('caps DOM rows for a wide tree and loads more explicitly', () => {
    const rows = deep(250).map(n => ({ ...n, parent_id: null, ancestor_ids: [], child_ids: [] }));
    render(<CategoryTree categories={rows} search="" filter="active" onSelect={vi.fn()} />);
    expect(screen.getAllByRole('treeitem')).toHaveLength(100);
    fireEvent.click(screen.getByRole('button', { name: /100 קטגוריות/ }));
    expect(screen.getAllByRole('treeitem')).toHaveLength(200);
  });
  it('reports expanded search results accurately and does not offer ineffective collapse controls', () => {
    render(<CategoryTree categories={deep(3)} search="node-" filter="active" onSelect={vi.fn()} />);
    expect(screen.getByRole('treeitem', { name: /node-0/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: /הרחבת/ })).not.toBeInTheDocument();
  });
});
