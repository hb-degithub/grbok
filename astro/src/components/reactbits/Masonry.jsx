import { Children, useMemo } from 'react';
import { motion } from 'framer-motion';
import useBreakpoint from '../../hooks/useBreakpoint';
import './Masonry.css';

const Masonry = ({
  children,
  columns = { mobile: 1, tablet: 2, desktop: 3 },
  gap = 16,
  className,
}) => {
  const { currentBreakpoint } = useBreakpoint();

  const columnCount = columns[currentBreakpoint] || columns.desktop || 3;

  const childArray = Children.toArray(children);

  const columnArrays = useMemo(() => {
    const cols = Array.from({ length: columnCount }, () => []);
    const colHeights = Array.from({ length: columnCount }, () => 0);

    childArray.forEach((child, index) => {
      const shortestIndex = colHeights.indexOf(Math.min(...colHeights));
      cols[shortestIndex].push({ child, index });
      colHeights[shortestIndex] += 1;
    });

    return cols;
  }, [childArray, columnCount]);

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: (i) => ({
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.4,
        delay: Math.min(i, 10) * 0.05,
        ease: [0.16, 1, 0.3, 1],
      },
    }),
  };

  return (
    <div
      className={`masonry-root${className ? ` ${className}` : ''}`}
      style={{ gap: `${gap}px` }}
    >
      {columnArrays.map((col, colIndex) => (
        <div
          key={colIndex}
          className="masonry-column"
          style={{ gap: `${gap}px` }}
        >
          {col.map(({ child, index }) => (
            <motion.div
              key={index}
              className="masonry-item"
              variants={itemVariants}
              initial="hidden"
              animate="visible"
              custom={index}
            >
              {child}
            </motion.div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default Masonry;
