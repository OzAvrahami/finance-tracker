import { Select } from '../../components/ui';
import { planningUnit, planningUnits, supportedPlanningUnit } from '../../../../shared/shoppingEntryOptions.mjs';

export default function ShoppingUnitSelect({ value, onValueChange, label = 'יחידה', ...props }) {
  const current = planningUnit(value);
  return <Select {...props} label={label} value={current} onValueChange={next => {
    if (supportedPlanningUnit(next)) onValueChange(next);
  }}>
    {!supportedPlanningUnit(current) && <option value={current}>{current} (יחידה קיימת)</option>}
    {planningUnits.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </Select>;
}
