const InstallmentProgress = ({ paid, total, className = '' }) => {
  const normalize = (value) => value !== null && value !== undefined && value !== ''
    && Number.isFinite(Number(value)) ? Number(value) : '−';
  const paidValue = normalize(paid);
  const totalValue = normalize(total);
  const label = `${paidValue} מתוך ${totalValue}`;

  return (
    <span
      className={`installment-progress ${className}`.trim()}
      dir="ltr"
      aria-label={label}
    >
      <bdi dir="ltr">{paidValue}</bdi>{' '}
      <span dir="rtl">מתוך</span>{' '}
      <bdi dir="ltr">{totalValue}</bdi>
    </span>
  );
};

export default InstallmentProgress;
