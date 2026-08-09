import { Skeleton, SkeletonCard } from '../../components/ui';

const TransactionFormSkeleton = () => (
  <div className="transaction-form-page" role="status" aria-label="טוען את פרטי התנועה">
    <span className="u-sr-only">טוען את פרטי התנועה</span>
    <div className="transaction-form-skeleton__intro">
      <Skeleton width="34%" height={18} />
      <Skeleton width="58%" height={14} />
    </div>
    <SkeletonCard height={250} />
    <SkeletonCard height={220} />
    <div className="transaction-form-skeleton__split">
      <SkeletonCard height={180} />
      <SkeletonCard height={180} />
    </div>
    <SkeletonCard height={110} />
  </div>
);

export default TransactionFormSkeleton;
