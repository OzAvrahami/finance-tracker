import { expect, it, vi } from 'vitest';
import { createSuggestionCache } from './shoppingSuggestionCache';
const deferred = () => { let resolve; const promise=new Promise(r=>{resolve=r;});return {promise,resolve}; };
const item = (id,name) => ({id,name});

it('ranks exact/prefix/substring deterministically and retains identities/defaults',async()=>{
 const fetch=vi.fn().mockResolvedValue({data:[item(3,'אבקת חלב'),item(2,'חלב עמיד'),{...item(1,'חלב'),default_unit:'kg',default_price:5},item(4,'USB-C')]});
 const cache=createSuggestionCache(fetch,2);await cache.load();
 expect(cache.matches(' חלב ').map(i=>i.id)).toEqual([1,2,3]);
 expect(cache.matches('usb')[0].id).toBe(4);expect(cache.matches('חלב')[0].default_unit).toBe('kg');
 expect(cache.matches('מטען')).toEqual([]);
});

it('never treats a preload or narrower eight-result query as a complete broader catalog',async()=>{
 const fetch=vi.fn().mockResolvedValue({data:[item(1,'חלב')]});const cache=createSuggestionCache(fetch,2);
 await cache.load();await cache.load('חלב');await cache.load('חל');await cache.load('חלב');
 expect(fetch.mock.calls.map(([params])=>[params.search,params.limit])).toEqual([['',20],['חלב',8],['חל',8]]);
});

it('deduplicates simultaneous identical queries and ignores cancelled work after clear/new query',async()=>{
 const pending=deferred();const fetch=vi.fn().mockReturnValue(pending.promise);const cache=createSuggestionCache(fetch,2);
 const a=cache.load('חל'),b=cache.load('חל');expect(fetch).toHaveBeenCalledTimes(1);
 cache.clear();expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
 pending.resolve({data:[item(1,'חלב')]});await Promise.all([a,b]);expect(cache.matches('חל')).toEqual([]);
 const older=deferred();fetch.mockReturnValueOnce(older.promise).mockResolvedValue({data:[item(2,'מטען')]});
 const old=cache.load('חל');await cache.load('מטען');older.resolve({data:[item(1,'חלב')]});await old;
 expect(cache.matches('חל')).toEqual([]);expect(cache.matches('מטען')).toHaveLength(1);
});

it('preserves useful local matches on failure and permits a safe retry',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({data:[item(1,'חלב')]}).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({data:[]});
 const cache=createSuggestionCache(fetch,2);await cache.load();await expect(cache.load('חל')).rejects.toThrow('offline');
 expect(cache.matches('חל')).toHaveLength(1);await cache.load('חל');expect(fetch).toHaveBeenCalledTimes(3);
});

it('bounds cached items and revalidates exact queries after the TTL',async()=>{
 let clock=1000;vi.spyOn(Date,'now').mockImplementation(()=>clock);
 const fetch=vi.fn().mockImplementation(({search})=>Promise.resolve({data:Array.from({length:8},(_,i)=>item(`${search}-${i}`,`${search}-${i}`))}));
 const cache=createSuggestionCache(fetch,2);
 for(let i=0;i<20;i++)await cache.load(`item${i}`);
 expect(cache.matches('item0-')).toEqual([]);
 await cache.load('item19');expect(fetch).toHaveBeenCalledTimes(20);
 clock+=30001;await cache.load('item19');expect(fetch).toHaveBeenCalledTimes(21);vi.restoreAllMocks();
});

it('does not use an evicted query as proof of absence and expires old cached rows',async()=>{
 let clock=1000;vi.spyOn(Date,'now').mockImplementation(()=>clock);
 try {
  const fetch=vi.fn().mockImplementation(({search})=>Promise.resolve({data:Array.from({length:8},(_,i)=>item(`${search}-${i}`,`${search}-${i}`))}));
  const cache=createSuggestionCache(fetch,2);for(let i=0;i<17;i++)await cache.load(`item${i}`);
  await cache.load('item0');expect(fetch).toHaveBeenCalledTimes(18);expect(cache.matches('item0')).toHaveLength(8);
  clock+=120001;expect(cache.matches('item0')).toEqual([]);
 } finally {vi.restoreAllMocks();}
});
