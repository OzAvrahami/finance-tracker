import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ShoppingSuggestionPopup from './ShoppingSuggestionPopup';
afterEach(()=>vi.restoreAllMocks());

it('uses a body portal, flips above the viewport bottom and follows scroll/resize',()=>{
 let rect={left:40,right:340,width:300,top:700,bottom:744,height:44};
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>rect);
 vi.spyOn(window,'innerHeight','get').mockReturnValue(768);
 vi.spyOn(window,'innerWidth','get').mockReturnValue(1024);
 const anchor=createRef(),dismiss=vi.fn();
 const {unmount}=render(<div style={{overflow:'hidden'}}><input ref={anchor}/><ShoppingSuggestionPopup anchorRef={anchor} onDismiss={dismiss}><ul role="listbox"><li>Test</li></ul></ShoppingSuggestionPopup></div>);
 const popup=screen.getByRole('listbox').parentElement;
 expect(popup.parentElement).toBe(document.body);expect(popup.style.maxHeight).toBe('320px');expect(popup.style.top).toBe('376px');
 fireEvent.pointerDown(popup);fireEvent.pointerDown(anchor.current);expect(dismiss).not.toHaveBeenCalled();
 fireEvent.pointerDown(document.body);expect(dismiss).toHaveBeenCalledTimes(1);
 rect={...rect,top:100,bottom:144};act(()=>fireEvent.scroll(window));expect(popup.style.top).toBe('148px');
 rect={...rect,top:1000,bottom:1044};act(()=>fireEvent.resize(window));expect(popup.style.visibility).toBe('hidden');
 unmount();expect(document.body.contains(popup)).toBe(false);fireEvent.pointerDown(document.body);expect(dismiss).toHaveBeenCalledTimes(1);
});

it('clamps width and placement to a narrow viewport without changing input geometry',()=>{
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({left:20,right:420,width:400,top:100,bottom:144,height:44});
 vi.spyOn(window,'innerWidth','get').mockReturnValue(320);
 vi.spyOn(window,'innerHeight','get').mockReturnValue(400);
 const anchor=createRef();render(<><input ref={anchor}/><ShoppingSuggestionPopup anchorRef={anchor}><ul role="listbox"/></ShoppingSuggestionPopup></>);
 const popup=screen.getByRole('listbox').parentElement;
 expect(popup.style.left).toBe('8px');expect(popup.style.width).toBe('304px');expect(popup.style.maxHeight).toBe('244px');
});
