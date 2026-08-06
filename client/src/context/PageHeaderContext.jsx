import { createContext, useContext } from 'react';

export const PageHeaderContext = createContext(null);

export function usePageHeaderContext() {
  const context = useContext(PageHeaderContext);

  if (!context) {
    throw new Error('usePageHeaderContext must be used inside PageHeaderProvider');
  }

  return context;
}
