import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CircleCheck, Info, X } from 'lucide-react';
import IconButton from './IconButton';
import ToastContext from './ToastContext';
import './feedback.css';

const toastIcons = {
  success: CircleCheck,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const defaultDurations = {
  success: 4500,
  info: 5000,
  warning: 6500,
  error: 7000,
};

let toastSequence = 0;

const ToastItem = ({ toast, onDismiss }) => {
  const Icon = toastIcons[toast.type] || Info;
  const itemRef = useRef(null);

  useEffect(() => {
    if (toast.persistent || toast.duration <= 0) return undefined;

    let remaining = toast.duration;
    let startedAt = Date.now();
    let timer = window.setTimeout(() => onDismiss(toast.id), remaining);
    let hovered = false;
    let focused = false;

    const pause = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
      timer = null;
    };
    const resume = () => {
      if (hovered || focused || remaining <= 0 || timer !== null) return;
      startedAt = Date.now();
      timer = window.setTimeout(() => onDismiss(toast.id), remaining);
    };
    const handleMouseEnter = () => { hovered = true; pause(); };
    const handleMouseLeave = () => { hovered = false; resume(); };
    const handleFocusIn = () => { focused = true; pause(); };
    const handleFocusOut = (event) => {
      if (itemRef.current?.contains(event.relatedTarget)) return;
      focused = false;
      resume();
    };

    const node = itemRef.current;
    node?.addEventListener('mouseenter', handleMouseEnter);
    node?.addEventListener('mouseleave', handleMouseLeave);
    node?.addEventListener('focusin', handleFocusIn);
    node?.addEventListener('focusout', handleFocusOut);

    return () => {
      window.clearTimeout(timer);
      node?.removeEventListener('mouseenter', handleMouseEnter);
      node?.removeEventListener('mouseleave', handleMouseLeave);
      node?.removeEventListener('focusin', handleFocusIn);
      node?.removeEventListener('focusout', handleFocusOut);
    };
  }, [onDismiss, toast.duration, toast.id, toast.persistent, toast.revision]);

  const runAction = () => {
    toast.action?.onClick?.();
    if (toast.action?.dismissOnClick !== false) onDismiss(toast.id);
  };

  return (
    <article
      ref={itemRef}
      className={`ui-toast ui-toast--${toast.type}`}
      role={toast.urgent ? 'alert' : 'status'}
      aria-live={toast.urgent ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <Icon className="ui-toast-icon" size={20} aria-hidden="true" />
      <div className="ui-toast-content">
        {toast.title && <strong>{toast.title}</strong>}
        <div>{toast.message}</div>
        {toast.action && (
          <button type="button" className="ui-toast-action" onClick={runAction}>
            {toast.action.label}
          </button>
        )}
      </div>
      <IconButton
        className="ui-toast-close"
        type="button"
        size="touch"
        aria-label="סגירת הודעה"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={17} aria-hidden="true" />
      </IconButton>
    </article>
  );
};

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((options) => {
    const normalized = typeof options === 'string' ? { message: options } : options;
    const type = normalized.type || 'info';
    const id = normalized.id || `toast-${++toastSequence}`;
    const toast = {
      ...normalized,
      id,
      type,
      urgent: normalized.urgent ?? false,
      persistent: normalized.persistent ?? false,
      duration: normalized.duration ?? defaultDurations[type],
      revision: Date.now(),
    };

    setToasts((current) => {
      const existingIndex = current.findIndex((item) => item.id === id);
      if (existingIndex < 0) return [...current, toast];
      return current.map((item, index) => (index === existingIndex ? toast : item));
    });
    return id;
  }, []);

  const api = useMemo(() => ({
    toasts,
    show: addToast,
    dismiss: dismissToast,
    success: (options) => addToast({ ...(typeof options === 'string' ? { message: options } : options), type: 'success' }),
    error: (options) => addToast({ ...(typeof options === 'string' ? { message: options } : options), type: 'error' }),
    warning: (options) => addToast({ ...(typeof options === 'string' ? { message: options } : options), type: 'warning' }),
    info: (options) => addToast({ ...(typeof options === 'string' ? { message: options } : options), type: 'info' }),
  }), [addToast, dismissToast, toasts]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toast-viewport" aria-label="הודעות זמניות">
        {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />)}
      </div>
    </ToastContext.Provider>
  );
};

export default ToastProvider;
