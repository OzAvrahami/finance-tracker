import { forwardRef } from 'react';
import TextField from './TextField';

const NumberField = forwardRef(({ inputMode = 'decimal', ...props }, ref) => (
  <TextField
    {...props}
    ref={ref}
    type="number"
    inputMode={inputMode}
    technicalLtr
  />
));

NumberField.displayName = 'NumberField';

export default NumberField;

