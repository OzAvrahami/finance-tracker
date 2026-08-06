import { useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { isTopOverlay, registerOverlay, unregisterOverlay } from './overlayManager';
import './overlay.css';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (panel) => (
  [...(panel?.querySelectorAll(focusableSelector) ?? [])]
    .filter((element) => element.getAttribute('aria-hidden') !== 'true')
);

const resolveFocusTarget = (target) => {
  if (typeof target === 'function') return target();
  return target?.current ?? target ?? null;
};

const Overlay = ({
  open,
  onClose,
  children,
  className = '',
  panelClassName = '',
  initialFocusRef,
  returnFocusRef,
  dismissOnEscape = true,
  dismissOnBackdrop = true,
  backdropLabel = 'סגירת חלון',
  labelledBy,
  describedBy,
  ariaLabel,
  role = 'dialog',
  ...panelProps
}) => {
  const reactId = useId();
  const overlayId = useRef(`overlay-${reactId}`);
  const layerRef = useRef(null);
  const panelRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const dismissOnEscapeRef = useRef(dismissOnEscape);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    dismissOnEscapeRef.current = dismissOnEscape;
  }, [dismissOnEscape, onClose]);

  useLayoutEffect(() => {
    if (!open) return undefined;

    const currentOverlayId = overlayId.current;
    restoreFocusRef.current = resolveFocusTarget(returnFocusRef) || document.activeElement;
    const zIndex = registerOverlay(currentOverlayId);
    if (layerRef.current) layerRef.current.style.zIndex = String(zIndex);

    const requestedTarget = resolveFocusTarget(initialFocusRef);
    const defaultTarget = getFocusableElements(panelRef.current)[0] || panelRef.current;
    const focusTarget = requestedTarget && panelRef.current?.contains(requestedTarget)
      ? requestedTarget
      : defaultTarget;
    focusTarget?.focus();

    const handleKeyDown = (event) => {
      if (!isTopOverlay(currentOverlayId)) return;

      if (event.key === 'Escape' && dismissOnEscapeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.('escape');
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(panelRef.current);
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const focusIsInside = panelRef.current?.contains(active);

      if (!focusIsInside || (event.shiftKey && active === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      unregisterOverlay(currentOverlayId);

      const restoreTarget = restoreFocusRef.current;
      if (restoreTarget?.isConnected && typeof restoreTarget.focus === 'function') {
        restoreTarget.focus();
      }
    };
  }, [initialFocusRef, open, returnFocusRef]);

  if (!open) return null;

  const requestBackdropClose = () => {
    if (dismissOnBackdrop && isTopOverlay(overlayId.current)) {
      onCloseRef.current?.('backdrop');
    }
  };

  return createPortal(
    <div ref={layerRef} className={`ui-overlay-layer ${className}`.trim()} data-overlay-root="true">
      {dismissOnBackdrop ? (
        <button
          type="button"
          className="ui-overlay-backdrop"
          aria-label={backdropLabel}
          tabIndex={-1}
          onClick={requestBackdropClose}
        />
      ) : (
        <div className="ui-overlay-backdrop" aria-hidden="true" />
      )}
      <div
        {...panelProps}
        ref={panelRef}
        className={`ui-overlay-panel ${panelClassName}`.trim()}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy || undefined}
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default Overlay;
