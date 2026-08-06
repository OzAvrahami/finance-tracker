import { forwardRef } from 'react';
import { CalendarDays } from 'lucide-react';
import TextField from './TextField';

const DateField = forwardRef(({ leading, ...props }, ref) => (
  <TextField
    {...props}
    ref={ref}
    type="date"
    technicalLtr
    leading={leading || <CalendarDays size={17} aria-hidden="true" />}
  />
));

DateField.displayName = 'DateField';

export default DateField;
