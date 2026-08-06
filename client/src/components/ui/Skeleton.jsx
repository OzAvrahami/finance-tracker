import React from 'react';

const Skeleton = ({
  width,
  height = 16,
  borderRadius = 'var(--ft-radius-sm)',
  style,
  className = '',
  ...props
}) => (
  <div
    {...props}
    className={`ui-skeleton ${className}`.trim()}
    aria-hidden={props['aria-hidden'] ?? true}
    style={{ width: width ?? '100%', height, borderRadius, ...style }}
  />
);

export const SkeletonText = ({ lines = 1, gap = 8 }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap }}>
    {Array.from({ length: lines }, (_, i) => (
      <Skeleton
        key={i}
        width={i === lines - 1 && lines > 1 ? '70%' : '100%'}
      />
    ))}
  </div>
);

export const SkeletonCard = ({ height = 120 }) => (
  <Skeleton height={height} borderRadius="var(--ft-radius-xl)" />
);

export default Skeleton;
