import React from 'react';

/**
 * Marks an explicit left-to-right technical value inside the RTL interface.
 * Formatting and parsing remain the caller's responsibility.
 */
const TechnicalValue = ({ children, className = '', ...props }) => (
  <bdi
    {...props}
    dir="ltr"
    className={`u-technical-ltr ${className}`.trim()}
  >
    {children}
  </bdi>
);

export default TechnicalValue;
