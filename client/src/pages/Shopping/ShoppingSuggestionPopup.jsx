import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Both comboboxes escape GlassCard clipping without changing any card's overflow.
export default function ShoppingSuggestionPopup({ anchorRef, children, onDismiss }) {
  const popup = useRef(null);
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft || 0) + 8;
      const topEdge = (viewport?.offsetTop || 0) + 8;
      const width = (viewport?.width || window.innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height || window.innerHeight) - 16;
      const below = Math.max(0,bottomEdge-rect.bottom-4), above = Math.max(0,rect.top-topEdge-4);
      const up = below < 200 && above > below;
      const maxHeight = Math.min(320,up ? above : below);
      const height = Math.min(popup.current?.scrollHeight || maxHeight,maxHeight);
      setPosition({ left: Math.max(leftEdge,Math.min(rect.left,leftEdge+width-Math.min(rect.width,width))),
        top: up ? rect.top-4-height : rect.bottom+4, width: Math.min(rect.width,width), maxHeight,
        visibility: rect.bottom < topEdge || rect.top > bottomEdge ? 'hidden' : 'visible' });
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    const dismissOutside = event => {
      if (!anchor.contains(event.target) && !popup.current?.contains(event.target)) onDismiss?.();
    };
    observer?.observe(anchor); if (popup.current) observer?.observe(popup.current);
    document.addEventListener('pointerdown',dismissOutside,true);
    window.addEventListener('resize',place);
    window.addEventListener('scroll',place,true);
    window.visualViewport?.addEventListener('resize',place);
    window.visualViewport?.addEventListener('scroll',place);
    return () => {
      observer?.disconnect(); window.removeEventListener('resize',place); window.removeEventListener('scroll',place,true);
      document.removeEventListener('pointerdown',dismissOutside,true);
      window.visualViewport?.removeEventListener('resize',place); window.visualViewport?.removeEventListener('scroll',place);
    };
  }, [anchorRef, children, onDismiss]);
  return createPortal(<div ref={popup} dir="rtl" className="shopping-suggestion-popup shopping-suggestion-overlay"
    style={position || { visibility:'hidden' }}
    onMouseDown={event => event.preventDefault()}>{children}</div>,document.body);
}
