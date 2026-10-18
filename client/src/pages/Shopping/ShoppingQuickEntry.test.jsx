import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import ShoppingQuickEntry from './ShoppingQuickEntry';
import { AuthContext } from '../../context/auth-context';
import { CATALOG_SUGGESTIONS_CHANGED } from './shoppingSuggestionCache';
import { addShoppingListItem, getShoppingCatalogCategories, getShoppingCatalogItems } from '../../services/api';
vi.mock('../../services/api', () => ({ addShoppingListItem: vi.fn(), getShoppingCatalogCategories: vi.fn(), getShoppingCatalogItems: vi.fn() }));
const milk = { id: 42, category_id: 3, name: 'חלב', default_unit: 'אריזה', default_price: 10.9, shopping_catalog_categories: { name: 'מזון' } };
const setup = () => { const ref=createRef(), onAdded=vi.fn(); render(<ShoppingQuickEntry list={{id:1,list_type_id:2}} inputRef={ref} onAdded={onAdded}/>); return {ref,onAdded}; };
const nameField = () => screen.getByRole('combobox', { name: 'מה צריך לקנות?' });
const type = async name => { await userEvent.type(nameField(),name); };
const add = async () => userEvent.click(screen.getByRole('button',{name:'הוספה'}));
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const details = async () => userEvent.click(screen.getByRole('button',{name:/פרטים נוספים/}));
const category = () => screen.getByRole('combobox',{name:'קטגוריה'});
const reuse = () => screen.getByLabelText('להציע את הפריט גם ברשימות הבאות');
const categories = [{id:3,name:'ירקות ופירות'},{id:4,name:'ציוד לבית'}];
beforeEach(()=>{vi.resetAllMocks();getShoppingCatalogCategories.mockResolvedValue({data:[]});getShoppingCatalogItems.mockResolvedValue({data:[]});addShoppingListItem.mockImplementation(async()=>{
 window.dispatchEvent(new Event(CATALOG_SUGGESTIONS_CHANGED));return {data:{id:1}};
});});
// Synthetic geometry for portal behavior; this does NOT verify browser layout.
beforeEach(()=>vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({left:20,right:320,top:100,bottom:144,width:300,height:44}));

it('defaults new names to reusable with empty catalog/categories, resets and restores focus',async()=>{
 const {ref}=setup();expect(screen.queryByLabelText('קטגוריה')).not.toBeInTheDocument();
 await type('מתנה לדנה');await screen.findByRole('option',{name:'הוספת “מתנה לדנה” כפריט חדש'});
 expect(addShoppingListItem).not.toHaveBeenCalled();await add();
 expect(addShoppingListItem).toHaveBeenCalledWith(1,expect.objectContaining({entry_mode:'name_first',custom_name:'מתנה לדנה',catalog_item_id:null,category_id:null,quantity:'1',save_to_catalog:true}));
 await waitFor(()=>expect(ref.current).toHaveFocus());expect(nameField()).toHaveValue('');
 await type('מטען 65W');await add();expect(addShoppingListItem).toHaveBeenCalledTimes(2);
 expect(addShoppingListItem).toHaveBeenLastCalledWith(1,expect.objectContaining({save_to_catalog:true}));
});
it('preloads bounded scoped suggestions and selects with arrows/Enter without submitting',async()=>{
 getShoppingCatalogItems.mockResolvedValue({data:[milk]});setup();await type('חל');
 await screen.findByRole('option',{name:/חלב.*מזון/});
 expect(getShoppingCatalogItems).toHaveBeenCalledWith({search:'',list_type_id:2,limit:20},expect.objectContaining({timeout:8000}));
 await userEvent.keyboard('{ArrowDown}{Enter}');expect(addShoppingListItem).not.toHaveBeenCalled();expect(nameField()).toHaveValue('חלב');
 expect(screen.getByLabelText('יחידה')).toHaveValue('אריזה');await add();
 expect(addShoppingListItem).toHaveBeenCalledWith(1,expect.objectContaining({catalog_item_id:42,custom_name:null,unit:'אריזה',price:10.9,quantity:'1',save_to_catalog:false}));
});
it('keeps typed requirements, notes and corrected defaults when selecting a suggestion',async()=>{
 getShoppingCatalogItems.mockResolvedValue({data:[milk]});setup();await type('חל');
 await userEvent.click(screen.getByRole('button',{name:/פרטים נוספים/}));
 await userEvent.type(screen.getByLabelText('הערות והעדפות'),'500 גרם בכל אריזה');
 await userEvent.selectOptions(screen.getByLabelText('יחידה'),'pack');
 fireEvent.change(screen.getByLabelText('מחיר משוער ליחידה'),{target:{value:'0'}});
 await userEvent.click(nameField());await userEvent.click(await screen.findByRole('option',{name:/חלב.*מזון/}));
 await userEvent.type(nameField(),' ללא לקטוז');
 fireEvent.change(screen.getByLabelText(/^כמות/),{target:{value:'2'}});await add();
 expect(addShoppingListItem).toHaveBeenCalledWith(1,expect.objectContaining({catalog_item_id:42,planned_name:'חלב ללא לקטוז',quantity:'2',unit:'pack',price:'0',notes:'500 גרם בכל אריזה'}));
});
it('allows explicit list-only choice, then resets checked with details collapsed after success',async()=>{
 setup();await type('עגבניות');await userEvent.click(screen.getByRole('button',{name:/פרטים נוספים/}));
 expect(reuse()).toBeChecked();await userEvent.click(reuse());
 fireEvent.change(screen.getByLabelText(/^כמות/),{target:{value:'0.5'}});await userEvent.selectOptions(screen.getByLabelText('יחידה'),'kg');await add();
 expect(addShoppingListItem).toHaveBeenCalledWith(1,expect.objectContaining({quantity:'0.5',unit:'kg',save_to_catalog:false}));
 expect(screen.queryByLabelText('קטגוריה')).not.toBeInTheDocument();expect(screen.getByLabelText(/^כמות/)).toHaveValue(1);
 await details();expect(reuse()).toBeChecked();
});
it('ignores stale search results and permits explicit new entry after search failure',async()=>{
 const old=deferred();getShoppingCatalogItems.mockImplementation(({search})=>search ? Promise.reject(new Error('offline')) : old.promise);
 setup();await type('חלב');await waitFor(()=>expect(getShoppingCatalogItems).toHaveBeenCalledTimes(1));
 await userEvent.clear(nameField());await type('מטען');await screen.findByText(/טעינת הצעות נוספות נכשלה/);
 await act(async()=>old.resolve({data:[milk]}));expect(screen.queryByRole('option',{name:/חלב.*מזון/})).not.toBeInTheDocument();
 await userEvent.click(screen.getByRole('option',{name:'הוספת “מטען” כפריט חדש'}));await add();
 expect(addShoppingListItem).toHaveBeenCalledWith(1,expect.objectContaining({custom_name:'מטען',catalog_item_id:null,save_to_catalog:true}));
});
it('preserves failed values, guards pending submissions, and Escape closes suggestions',async()=>{
 const request=deferred();addShoppingListItem.mockReturnValueOnce(request.promise);setup();await type('מטען');
 await userEvent.keyboard('{Escape}');expect(nameField()).toHaveAttribute('aria-expanded','false');await add();
 fireEvent.submit(screen.getByRole('form',{name:'הוספת פריט לרשימה'}));expect(addShoppingListItem).toHaveBeenCalledTimes(1);
 await act(async()=>request.reject(new Error('offline')));expect(nameField()).toHaveValue('מטען');expect(screen.getByRole('alert')).toHaveTextContent('הפרטים נשמרו');
 await add();expect(addShoppingListItem).toHaveBeenCalledTimes(2);
});

it('shows scoped categories on focus, filters, and commits only an explicit selection',async()=>{
 getShoppingCatalogCategories.mockResolvedValue({data:categories});setup();await type('מלפפון');await details();
 await userEvent.click(category());expect(screen.getByRole('option',{name:'ציוד לבית'})).toBeInTheDocument();
 await userEvent.type(category(),'ירק');expect(screen.queryByRole('option',{name:'ציוד לבית'})).not.toBeInTheDocument();
 expect(screen.getByText(/קטגוריה חדשה תיווצר בהוספה:/)).toHaveTextContent('ירק');
 await userEvent.keyboard('{ArrowDown}');expect(category()).toHaveValue('ירק');
 expect(screen.getByRole('option',{name:'ירקות ופירות'})).toHaveAttribute('aria-selected','false');
 await userEvent.keyboard('{Enter}');expect(category()).toHaveValue('ירקות ופירות');expect(addShoppingListItem).not.toHaveBeenCalled();
 await add();expect(addShoppingListItem).toHaveBeenCalledWith(1,expect.objectContaining({category_id:'3',save_to_catalog:true}));
});

it('Escape, Tab, blur and details collapse never create or silently complete a partial category',async()=>{
 getShoppingCatalogCategories.mockResolvedValue({data:categories});setup();await type('מלפפון');await details();
 await userEvent.type(category(),'ירק');await userEvent.keyboard('{ArrowDown}{Escape}');
 expect(category()).toHaveValue('ירק');expect(category()).toHaveAttribute('aria-expanded','false');
 await userEvent.click(category());await userEvent.keyboard('{ArrowDown}{Tab}');expect(category()).toHaveValue('ירק');
 await details();await details();expect(category()).toHaveValue('ירק');expect(addShoppingListItem).not.toHaveBeenCalled();
 await add();expect(addShoppingListItem).toHaveBeenCalledWith(1,expect.objectContaining({category_id:null,category_name:'ירק'}));
});

it('submits normalized typed names for authoritative resolution and remembers canonical categories',async()=>{
 getShoppingCatalogCategories.mockResolvedValue({data:categories});
 addShoppingListItem.mockResolvedValue({data:{id:1,shopping_catalog_categories:{id:8,name:'ציוד לטיולים'}}});
 setup();await type('אוהל');await details();await userEvent.type(category(),'  ציוד   לטיולים  ');
 await add();expect(addShoppingListItem).toHaveBeenCalledWith(1,expect.objectContaining({category_name:'ציוד לטיולים',save_to_catalog:true}));
 await details();await userEvent.click(category());await userEvent.click(screen.getByRole('option',{name:'ציוד לטיולים'}));
 expect(category()).toHaveValue('ציוד לטיולים');await userEvent.clear(category());await type('מתנה');await add();
 expect(addShoppingListItem).toHaveBeenLastCalledWith(1,expect.objectContaining({category_id:null,category_name:null}));
});

it('exact name is not presented as new; failed suggestions still submit a name for server resolution',async()=>{
 getShoppingCatalogCategories.mockRejectedValue(new Error('offline'));setup();await type('מתנה');await details();
 await userEvent.type(category(),'  ציוד   לבית ');expect(screen.getByText(/טעינת ההצעות נכשלה/)).toHaveTextContent('הקטגוריה תיבדק');
 expect(screen.queryByText(/קטגוריה חדשה תיווצר בהוספה:/)).not.toBeInTheDocument();
 await add();expect(addShoppingListItem).toHaveBeenCalledWith(1,expect.objectContaining({category_id:null,category_name:'ציוד לבית'}));
});

it('normalized exact suggestion, validation failure and failed submission preserve all fields',async()=>{
 getShoppingCatalogCategories.mockResolvedValue({data:categories});addShoppingListItem.mockRejectedValue(new Error('offline'));
 setup();await details();await userEvent.type(category(),'  ציוד   לבית  ');
 expect(screen.queryByText(/קטגוריה חדשה תיווצר בהוספה:/)).not.toBeInTheDocument();
 fireEvent.submit(screen.getByRole('form'));expect(addShoppingListItem).not.toHaveBeenCalled();
 await type('מטען 65W');await userEvent.selectOptions(screen.getByLabelText('יחידה'),'pair');
 fireEvent.change(screen.getByLabelText(/^כמות/),{target:{value:'0.125'}});
 await userEvent.type(screen.getByLabelText('הערות והעדפות'),'שתי יציאות');
 fireEvent.change(screen.getByLabelText('מחיר משוער ליחידה'),{target:{value:'25'}});
 await add();
 expect(nameField()).toHaveValue('מטען 65W');expect(category()).toHaveValue('  ציוד   לבית  ');
 expect(screen.getByLabelText(/^כמות/)).toHaveValue(0.125);expect(screen.getByLabelText('יחידה')).toHaveValue('pair');
 expect(screen.getByLabelText('הערות והעדפות')).toHaveValue('שתי יציאות');expect(screen.getByLabelText('מחיר משוער ליחידה')).toHaveValue(25);
 expect(reuse()).toBeChecked();
});

it.each([true,false])('preserves reusable choice %s after a duplicate rejection and explicit new-name selection',async checked=>{
 addShoppingListItem.mockRejectedValueOnce({response:{data:{error:'פריט בשם זה כבר קיים בקטגוריה.'}}});
 setup();await type('מתנה');await details();if(!checked)await userEvent.click(reuse());
 await userEvent.click(nameField());await userEvent.click(await screen.findByRole('option',{name:'הוספת “מתנה” כפריט חדש'}));
 expect(reuse().checked).toBe(checked);expect(addShoppingListItem).not.toHaveBeenCalled();await add();
 expect(screen.getByRole('alert')).toHaveTextContent('פריט בשם זה כבר קיים');
 expect(nameField()).toHaveValue('מתנה');expect(reuse().checked).toBe(checked);
 await add();expect(addShoppingListItem).toHaveBeenLastCalledWith(1,expect.objectContaining({save_to_catalog:checked}));
});

it('explicitly right-aligns empty Hebrew placeholders initially, after clearing and after success',async()=>{
 const {ref}=setup();
 const assertEmptyRTL = input => {
  expect(input).toHaveValue('');expect(input).toHaveAttribute('dir','rtl');
  expect(getComputedStyle(input).textAlign).toBe('right');
 };
 assertEmptyRTL(nameField());await details();
 const notes=()=>screen.getByLabelText('הערות והעדפות');assertEmptyRTL(notes());
 expect(notes()).toHaveAttribute('placeholder','העדפות או פרטים שחשוב לזכור…');
 for(const value of ['חלב','USB-C charger','מטען USB-C 65W']) {
  for(const input of [nameField(),notes()]) {
   await userEvent.type(input,value);
   expect(input).toHaveValue(value);expect(input).toHaveAttribute('dir','auto');
   expect(getComputedStyle(input).textAlign).toBe('start');
   await userEvent.clear(input);assertEmptyRTL(input);
  }
 }
 expect(screen.getByLabelText(/^כמות/)).toHaveAttribute('dir','ltr');
 expect(screen.getByLabelText('מחיר משוער ליחידה')).toHaveAttribute('dir','ltr');
 expect(reuse()).toBeChecked();
 await type('מטען USB-C 65W');await userEvent.type(notes(),'USB-C — העדפה אישית');await add();
 expect(addShoppingListItem).toHaveBeenCalledWith(1,expect.objectContaining({custom_name:'מטען USB-C 65W',notes:'USB-C — העדפה אישית',save_to_catalog:true}));
 await waitFor(()=>expect(ref.current).toHaveFocus());assertEmptyRTL(nameField());
 await details();assertEmptyRTL(notes());expect(reuse()).toBeChecked();
});

it('offers seven closed units, never rescales fractions or package contents, and resets consecutive entries',async()=>{
 setup();await type('אגוזים 500 גרם');const unit=screen.getByLabelText('יחידה');expect(unit).toHaveValue('unit');
 expect([...unit.options].map(o=>o.value)).toEqual(['unit','kg','g','l','ml','pack','pair']);
 fireEvent.change(screen.getByLabelText(/^כמות/),{target:{value:'0.125'}});
 await userEvent.click(screen.getByRole('button',{name:'הגדלת כמות'}));expect(screen.getByLabelText(/^כמות/)).toHaveValue(1.125);
 await userEvent.click(screen.getByRole('button',{name:'הקטנת כמות'}));expect(screen.getByLabelText(/^כמות/)).toHaveValue(0.125);
 await userEvent.selectOptions(unit,'pack');expect(screen.getByLabelText(/^כמות/)).toHaveValue(0.125);
 await details();expect(screen.getAllByLabelText('יחידה')).toHaveLength(1);await add();
 expect(addShoppingListItem).toHaveBeenCalledWith(1,expect.objectContaining({quantity:'0.125',unit:'pack',unit_mode:'controlled'}));
 expect(screen.getByLabelText('יחידה')).toHaveValue('unit');expect(screen.getByLabelText(/^כמות/)).toHaveValue(1);
});

it('loads supported saved units and preserves a legacy value until deliberate replacement',async()=>{
 getShoppingCatalogItems.mockResolvedValue({data:[{...milk,default_unit:'ק״ג'}]});setup();await type('חל');
 await userEvent.click(await screen.findByRole('option',{name:/חלב.*מזון/}));expect(screen.getByLabelText('יחידה')).toHaveValue('kg');
 getShoppingCatalogItems.mockResolvedValue({data:[milk]});await add();await type('חל');
 await userEvent.click(await screen.findByRole('option',{name:/חלב.*מזון/}));expect(screen.getByLabelText('יחידה')).toHaveValue('אריזה');
 await userEvent.selectOptions(screen.getByLabelText('יחידה'),'pack');await add();
 expect(addShoppingListItem).toHaveBeenLastCalledWith(1,expect.objectContaining({catalog_item_id:42,unit:'pack'}));
});

it('renders available matches in the same input update while delayed remote work is pending',async()=>{
 const remote=deferred();getShoppingCatalogItems.mockImplementation(({search})=>search ? remote.promise : Promise.resolve({data:[milk]}));
 setup();await act(async()=>{});
 fireEvent.focus(nameField());
 fireEvent.change(nameField(),{target:{value:'חל'}});
 expect(screen.getByRole('option',{name:/חלב.*מזון/})).toBeInTheDocument();
 expect(getShoppingCatalogItems).toHaveBeenCalledTimes(1); // no timer/network needed for this render
 await waitFor(()=>expect(getShoppingCatalogItems).toHaveBeenCalledTimes(2));
 expect(screen.getByRole('option',{name:/חלב.*מזון/})).toBeInTheDocument();
 await act(async()=>remote.reject(new Error('offline')));
 expect(screen.getByRole('option',{name:/חלב.*מזון/})).toBeInTheDocument();
 fireEvent.change(nameField(),{target:{value:'מטען'}});
 expect(screen.queryByRole('option',{name:/חלב.*מזון/})).not.toBeInTheDocument();
 expect(screen.getByRole('option',{name:'הוספת “מטען” כפריט חדש'})).toBeInTheDocument();
});

it('separates cold debounce/network delay from immediate warm input updates',async()=>{
 vi.useFakeTimers();
 try {
  getShoppingCatalogItems.mockImplementation(({search})=>search ? new Promise(resolve=>setTimeout(()=>resolve({data:[milk]}),1000)) : Promise.resolve({data:[]}));
  setup();await act(async()=>{});fireEvent.change(nameField(),{target:{value:'חל'}});
  await act(async()=>vi.advanceTimersByTimeAsync(249));expect(getShoppingCatalogItems).toHaveBeenCalledTimes(1);
  await act(async()=>vi.advanceTimersByTimeAsync(1));expect(getShoppingCatalogItems).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status')).toHaveTextContent('מחפש');
  await act(async()=>vi.advanceTimersByTimeAsync(999));expect(screen.queryByRole('option',{name:/חלב.*מזון/})).not.toBeInTheDocument();
  await act(async()=>vi.advanceTimersByTimeAsync(1));expect(screen.getByRole('option',{name:/חלב.*מזון/})).toBeInTheDocument();
  // No timer advance, request dispatch or waiting: broaden/narrow from available data.
  fireEvent.change(nameField(),{target:{value:'ח'}});expect(screen.getByRole('option',{name:/חלב.*מזון/})).toBeInTheDocument();
  fireEvent.change(nameField(),{target:{value:'חלב'}});expect(screen.getByRole('option',{name:/חלב.*מזון/})).toBeInTheDocument();
  expect(getShoppingCatalogItems).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(nameField(),{key:'ArrowDown'});
  await act(async()=>vi.advanceTimersByTimeAsync(1250));
  expect(screen.getByRole('option',{name:/חלב.*מזון/})).toHaveAttribute('aria-selected','true');
  fireEvent.keyDown(nameField(),{key:'Enter'});expect(addShoppingListItem).not.toHaveBeenCalled();
  expect(nameField()).toHaveValue('חלב');
 } finally {vi.useRealTimers();}
});

it('isolates results by list type and authenticated owner, including late responses',async()=>{
 const old=deferred();getShoppingCatalogItems.mockReturnValueOnce(old.promise).mockResolvedValue({data:[]});
 const ref=createRef();const view=(owner,scope)=><AuthContext.Provider value={{user:{id:owner}}}><ShoppingQuickEntry list={{id:1,list_type_id:scope}} inputRef={ref} onAdded={vi.fn()}/></AuthContext.Provider>;
 const {rerender}=render(view('first',2));fireEvent.change(nameField(),{target:{value:'חל'}});
 rerender(view('first',3));await act(async()=>old.resolve({data:[milk]}));
 expect(screen.queryByRole('option',{name:/חלב.*מזון/})).not.toBeInTheDocument();
 getShoppingCatalogItems.mockResolvedValue({data:[milk]});rerender(view('second',3));await act(async()=>{});
 expect(screen.getByRole('option',{name:/חלב.*מזון/})).toBeInTheDocument();
 getShoppingCatalogItems.mockResolvedValue({data:[]});rerender(view(null,3));await act(async()=>{});
 expect(screen.queryByRole('option',{name:/חלב.*מזון/})).not.toBeInTheDocument();
});

it('invalidates suggestions on catalog mutations and successful reusable addition',async()=>{
 getShoppingCatalogItems.mockResolvedValue({data:[milk]});setup();await act(async()=>{});
 fireEvent.change(nameField(),{target:{value:'חל'}});expect(screen.getByRole('option',{name:/חלב.*מזון/})).toBeInTheDocument();
 getShoppingCatalogItems.mockResolvedValue({data:[]});await act(async()=>window.dispatchEvent(new Event(CATALOG_SUGGESTIONS_CHANGED)));
 expect(screen.queryByRole('option',{name:/חלב.*מזון/})).not.toBeInTheDocument();
 getShoppingCatalogItems.mockResolvedValue({data:[milk]});await add();
 fireEvent.change(nameField(),{target:{value:'חל'}});expect(screen.getByRole('option',{name:/חלב.*מזון/})).toBeInTheDocument();
});

it('portals both popups outside the clipping card and right-aligns the empty category',async()=>{
 getShoppingCatalogCategories.mockResolvedValue({data:categories});setup();await type('חלב');
 expect(screen.getByRole('listbox').closest('.ui-glass')).toBeNull();
 await details();await userEvent.click(category());
 expect(category()).toHaveAttribute('dir','rtl');expect(category()).toHaveStyle({textAlign:'right'});
 const popup=screen.getByRole('listbox',{name:'הצעות לקטגוריה'});
 expect(popup.closest('.ui-glass')).toBeNull();expect(popup.parentElement).toHaveClass('shopping-suggestion-overlay');
 await userEvent.click(screen.getByRole('option',{name:'ציוד לבית'}));expect(category()).toHaveValue('ציוד לבית');
 expect(category()).toHaveFocus();expect(category()).toHaveAttribute('aria-expanded','false');
 await userEvent.clear(category());expect(category()).toHaveAttribute('dir','rtl');
 await userEvent.type(category(),'קטגוריה חדשה');expect(screen.getByText(/קטגוריה חדשה תיווצר בהוספה:/)).toHaveTextContent('קטגוריה חדשה');
 expect(addShoppingListItem).not.toHaveBeenCalled();
});
