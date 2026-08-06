import { useCallback, useMemo, useState } from 'react';
import { PageHeaderContext } from './PageHeaderContext';

const normalizeHeader = (header) => {
  if (!header) return null;
  const { subtitles, subtitle, ...rest } = header;
  return {
    ...rest,
    subtitle: subtitle ?? subtitles,
  };
};

const PageHeaderProvider = ({ defaultHeader, children }) => {
  const [headerOverride, setHeaderOverride] = useState(null);

  const setPageHeader = useCallback((nextHeader) => {
    setHeaderOverride((currentHeader) => normalizeHeader(
      typeof nextHeader === 'function' ? nextHeader(currentHeader) : nextHeader,
    ));
  }, []);

  const resetPageHeader = useCallback(() => setHeaderOverride(null), []);

  const pageHeader = useMemo(() => {
    const normalizedDefault = normalizeHeader(defaultHeader) ?? {};
    const resolved = headerOverride
      ? {
          ...normalizedDefault,
          ...headerOverride,
          title: normalizedDefault.title ?? headerOverride.title,
        }
      : normalizedDefault;

    return {
      ...resolved,
      subtitles: resolved.subtitle,
    };
  }, [defaultHeader, headerOverride]);

  const value = useMemo(() => ({
    pageHeader,
    setPageHeader,
    resetPageHeader,
  }), [pageHeader, resetPageHeader, setPageHeader]);

  return (
    <PageHeaderContext.Provider value={value}>
      {children}
    </PageHeaderContext.Provider>
  );
};

export default PageHeaderProvider;
