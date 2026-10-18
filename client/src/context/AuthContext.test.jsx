import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthContext';
import ProtectedRoute from '../components/ProtectedRoute';

const auth = vi.hoisted(()=>({ getSession:vi.fn(),onAuthStateChange:vi.fn(),signOut:vi.fn() }));
vi.mock('../config/supabase',()=>({supabase:{auth}}));
let callbacks,unsubscribes;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const mount=()=>render(<StrictMode><MemoryRouter><AuthProvider><ProtectedRoute><div>Authenticated app</div></ProtectedRoute></AuthProvider></MemoryRouter></StrictMode>);
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();callbacks=[];unsubscribes=[];
 auth.onAuthStateChange.mockImplementation(callback=>{callbacks.push(callback);const unsubscribe=vi.fn();unsubscribes.push(unsubscribe);return {data:{subscription:{unsubscribe}}};});
});
afterEach(()=>vi.useRealTimers());

it('bounds a hung session refresh, retries, and ignores late results from the previous attempt',async()=>{
 const stuck=deferred();auth.getSession.mockReturnValue(stuck.promise);mount();await act(async()=>{});
 expect(screen.getByRole('status')).toHaveAttribute('aria-busy','true');
 await act(async()=>vi.advanceTimersByTimeAsync(15000));expect(screen.getByRole('alert')).toHaveTextContent('בדיקת ההתחברות');
 expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(screen.queryByText('Authenticated app')).not.toBeInTheDocument();
 auth.getSession.mockResolvedValue({data:{session:{user:{id:'local-review'}}},error:null});
 fireEvent.click(screen.getByRole('button',{name:'ניסיון חוזר'}));await act(async()=>{});
 expect(screen.getByText('Authenticated app')).toBeInTheDocument();
 await act(async()=>stuck.resolve({data:{session:null},error:new Error('late failure')}));
 expect(screen.getByText('Authenticated app')).toBeInTheDocument();expect(auth.signOut).not.toHaveBeenCalled();
});

it.each(['reject','returned error'])('terminates loading on %s without exposing raw service errors',async mode=>{
 if(mode==='reject')auth.getSession.mockRejectedValue(new Error('private service details'));
 else auth.getSession.mockResolvedValue({data:{session:null},error:new Error('private service details')});
 mount();await act(async()=>{});expect(screen.getByRole('alert')).toBeInTheDocument();
 expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(screen.queryByText(/private service/)).not.toBeInTheDocument();
});

it('recovers on a valid auth event and prevents the old bootstrap from overwriting it',async()=>{
 const pending=deferred();auth.getSession.mockReturnValue(pending.promise);mount();await act(async()=>{});
 await act(async()=>vi.advanceTimersByTimeAsync(15000));expect(screen.getByRole('alert')).toBeInTheDocument();
 act(()=>callbacks.at(-1)('SIGNED_IN',{user:{id:'local-review'}}));expect(screen.getByText('Authenticated app')).toBeInTheDocument();
 await act(async()=>pending.reject(new Error('old refresh')));expect(screen.getByText('Authenticated app')).toBeInTheDocument();
});

it('cleans up timers/subscriptions and ignores callbacks after unmount',async()=>{
 auth.getSession.mockReturnValue(new Promise(()=>{}));const view=mount();await act(async()=>{});view.unmount();
 expect(unsubscribes.every(unsubscribe=>unsubscribe.mock.calls.length===1)).toBe(true);
 expect(vi.getTimerCount()).toBe(0);act(()=>callbacks.at(-1)('SIGNED_IN',{user:{id:'late'}}));
 expect(screen.queryByText('Authenticated app')).not.toBeInTheDocument();
});

it('does not restore a signed-out identity from a late bootstrap response',async()=>{
 const pending=deferred();auth.getSession.mockReturnValue(pending.promise);mount();await act(async()=>{});
 act(()=>callbacks.at(-1)('SIGNED_OUT',null));
 await act(async()=>pending.resolve({data:{session:{user:{id:'old-user'}}},error:null}));
 expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(screen.queryByText('Authenticated app')).not.toBeInTheDocument();
});
