import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SavingsMonthlyDialog from './SavingsMonthlyDialog';
import * as api from '../../services/api';
vi.mock('../../services/api', () => ({ getSavingsAccount:vi.fn(),getCategories:vi.fn(),getPaymentSources:vi.fn(),getTransactionById:vi.fn(),getTransactions:vi.fn(),postSavingsEvent:vi.fn(),correctSavingsEvent:vi.fn(),updateSavingsAccount:vi.fn() }));
const account={id:'1',name:'בדיקת תוכנית',status:'active',revision:'5',plan_revision:'2',monthly_amount:'100.00',monthly_day:31,next_due_date:'2026-01-31',default_payment_source_id:'2',auto_deposit_enabled:false};
beforeEach(()=>{
 vi.clearAllMocks();api.getSavingsAccount.mockResolvedValue({data:{account}});api.getCategories.mockResolvedValue({data:[{id:'3',savings_role:'deposit'}]});api.getPaymentSources.mockResolvedValue({data:[{id:'2',name:'בנק'}]});
 for(const fn of [api.postSavingsEvent,api.correctSavingsEvent,api.updateSavingsAccount])fn.mockResolvedValue({data:{affected_account_ids:['1']}});
});
const setup=()=>{const saved=vi.fn();render(<SavingsMonthlyDialog context={{account}} onClose={vi.fn()} onSaved={saved}/>);return {user:userEvent.setup(),saved};};
const confirm=async user=>user.click(screen.getByRole('checkbox',{name:/אישרתי את המועד/}));
it('requires confirmation, stores explicit automation separately and never posts when enabling',async()=>{
 const {user}=setup();const button=await screen.findByRole('button',{name:'הפעלת רישום אוטומטי'});await user.click(button);expect(api.updateSavingsAccount).not.toHaveBeenCalled();await confirm(user);await user.click(button);
 await waitFor(()=>expect(api.updateSavingsAccount).toHaveBeenCalledOnce());expect(api.updateSavingsAccount.mock.calls[0][1].account).toEqual({auto_deposit_enabled:true});expect(api.postSavingsEvent).not.toHaveBeenCalled();
});
it('sends explicit nominal-month identity and exact money for manual fulfillment',async()=>{
 const {user,saved}=setup();await screen.findByLabelText(/סכום ההפקדה/);await confirm(user);await user.click(screen.getByRole('button',{name:'הסדרת המועד'}));await waitFor(()=>expect(saved).toHaveBeenCalled());
 expect(api.postSavingsEvent.mock.calls[0][0].command).toMatchObject({action:'create_cash',amount:'100.00',account_id:'1',occurrence_month:'2026-01-01',expected_due_date:'2026-01-31',plan_revision:'2',expected_revision:'5'});
});
it('explicitly links an existing deposit without editing authoritative cash fields',async()=>{
 const cash={id:9,description:'הפקדה קיימת',total_amount:'100.00',transaction_date:'2026-01-20',charge_date:'2026-02-01',payment_source_id:2,movement_type:'expense',transaction_fingerprint:'fp',savings:{active:true,account_id:'1',event_kind:'deposit',source_kind:'manual'}};
 api.getTransactions.mockResolvedValue({data:{data:[cash],pagination:{nextCursor:null}}});api.getTransactionById.mockResolvedValue({data:cash});const {user}=setup();await screen.findByLabelText('אופן ההסדרה');await user.selectOptions(screen.getByLabelText('אופן ההסדרה'),'existing');await screen.findByRole('option',{name:/הפקדה קיימת ·/});await user.selectOptions(screen.getByLabelText('תנועה קיימת'),'9');await waitFor(()=>expect(screen.getByLabelText(/סכום ההפקדה/)).toBeDisabled());await confirm(user);await user.click(screen.getByRole('button',{name:'הסדרת המועד'}));await waitFor(()=>expect(api.postSavingsEvent).toHaveBeenCalled());
 expect(api.postSavingsEvent.mock.calls[0][0].command).toMatchObject({action:'link_cash',transaction_id:'9',expected_transaction_fingerprint:'fp',effective_date:'2026-01-20',charge_date:'2026-02-01'});
});
it('skip needs a reason and submits no cash fields',async()=>{
 const {user}=setup();await screen.findByLabelText('אופן ההסדרה');await user.selectOptions(screen.getByLabelText('אופן ההסדרה'),'skip');await confirm(user);await user.click(screen.getByRole('button',{name:'הסדרת המועד'}));expect(api.postSavingsEvent).not.toHaveBeenCalled();await user.type(screen.getByLabelText('סיבה לדילוג, חריגה או החזרה'),'החלטת בעלים');await confirm(user);await user.click(screen.getByRole('button',{name:'הסדרת המועד'}));await waitFor(()=>expect(api.postSavingsEvent).toHaveBeenCalled());expect(api.postSavingsEvent.mock.calls[0][0].command).toMatchObject({action:'skip',reason:'החלטת בעלים'});expect(api.postSavingsEvent.mock.calls[0][0].command).not.toHaveProperty('amount');
});
