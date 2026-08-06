import { createContext, useContext, useId, useState } from 'react';
import './selection.css';

const TabsContext = createContext(null);

const useTabsContext = () => {
  const context = useContext(TabsContext);
  if (!context) throw new Error('Tabs components must be rendered inside Tabs.');
  return context;
};

const safeToken = (value) => encodeURIComponent(String(value));

export const Tabs = ({
  value,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  direction = 'rtl',
  children,
  className = '',
}) => {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const baseId = useId().replaceAll(':', '');
  const selectedValue = value === undefined ? internalValue : value;

  const select = (nextValue) => {
    if (value === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
  };

  const context = {
    selectedValue,
    select,
    orientation,
    direction,
    tabId: (tabValue) => `tabs-${baseId}-tab-${safeToken(tabValue)}`,
    panelId: (tabValue) => `tabs-${baseId}-panel-${safeToken(tabValue)}`,
  };

  return (
    <TabsContext.Provider value={context}>
      <div className={`ui-tabs ui-tabs--${orientation} ${className}`.trim()} dir={direction}>
        {children}
      </div>
    </TabsContext.Provider>
  );
};

export const TabList = ({ children, className = '', ...props }) => {
  const { orientation, direction } = useTabsContext();

  const handleKeyDown = (event) => {
    const enabledTabs = [...event.currentTarget.querySelectorAll('[role="tab"]:not(:disabled)')];
    const currentIndex = enabledTabs.indexOf(document.activeElement);
    if (currentIndex < 0 || !enabledTabs.length) return;

    let nextIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = enabledTabs.length - 1;
    else if (orientation === 'vertical' && event.key === 'ArrowDown') nextIndex = currentIndex + 1;
    else if (orientation === 'vertical' && event.key === 'ArrowUp') nextIndex = currentIndex - 1;
    else if (orientation === 'horizontal' && event.key === 'ArrowRight') {
      nextIndex = currentIndex + (direction === 'rtl' ? -1 : 1);
    } else if (orientation === 'horizontal' && event.key === 'ArrowLeft') {
      nextIndex = currentIndex + (direction === 'rtl' ? 1 : -1);
    } else return;

    event.preventDefault();
    const wrappedIndex = (nextIndex + enabledTabs.length) % enabledTabs.length;
    enabledTabs[wrappedIndex].focus();
    enabledTabs[wrappedIndex].click();
  };

  return (
    <div
      {...props}
      className={`ui-tab-list ${className}`.trim()}
      role="tablist"
      aria-orientation={orientation}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
};

export const Tab = ({ value, children, badge, disabled = false, className = '', ...props }) => {
  const { selectedValue, select, tabId, panelId } = useTabsContext();
  const selected = selectedValue === value;

  return (
    <button
      {...props}
      type="button"
      id={tabId(value)}
      className={`ui-tab${selected ? ' is-selected' : ''} ${className}`.trim()}
      role="tab"
      aria-selected={selected}
      aria-controls={panelId(value)}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => select(value)}
    >
      <span>{children}</span>
      {badge !== undefined && badge !== null && <span className="ui-tab-badge">{badge}</span>}
    </button>
  );
};

export const TabPanel = ({ value, children, className = '', ...props }) => {
  const { selectedValue, tabId, panelId } = useTabsContext();
  const selected = selectedValue === value;

  return (
    <div
      {...props}
      id={panelId(value)}
      className={`ui-tab-panel ${className}`.trim()}
      role="tabpanel"
      aria-labelledby={tabId(value)}
      tabIndex={0}
      hidden={!selected}
    >
      {children}
    </div>
  );
};

export default Tabs;
