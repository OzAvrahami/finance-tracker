import { useEffect } from 'react';

export function confirmDiscard(dirty) {
  return !dirty || window.confirm('יש שינויים שלא נשמרו. לצאת ולבטל אותם?');
}

export function useUnsavedChanges(dirty) {
  useEffect(() => {
    if (!dirty) return;
    // Preview links perform full-page navigation. The browser coalesces these
    // handlers into one leave warning, even with drafts in several tabs.
    // A custom click confirmation would repeat once per draft and then again
    // at beforeunload. Explicit dialog cancellation still uses confirmDiscard.
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
}
