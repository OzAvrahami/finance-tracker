import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import ShoppingListDialog from './ShoppingListDialog';

it('preserves a typed draft when list types arrive after opening', async () => {
  const user=userEvent.setup(),onSave=vi.fn(),props={open:true,onClose:vi.fn(),onSave};
  const view=render(<ShoppingListDialog {...props} listTypes={[]} />);
  await user.type(screen.getByLabelText(/שם הרשימה/),'Late reference data');
  view.rerender(<ShoppingListDialog {...props} listTypes={[{id:7,name:'Synthetic'}]} />);
  expect(screen.getByLabelText(/שם הרשימה/)).toHaveValue('Late reference data');
  await user.click(screen.getByRole('button',{name:'יצירת הרשימה',exact:true}));
  await waitFor(()=>expect(onSave).toHaveBeenCalledWith({title:'Late reference data',list_type_id:'7'}));
});
