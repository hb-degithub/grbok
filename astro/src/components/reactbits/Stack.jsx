import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './Stack.css';

const Stack = ({
  children,
  onSwipe,
  cardWidth = '100%',
  cardHeight = 200,
  sensitivity = 100,
  className,
  mobileClickOnly = false,
}) => {
  const [stack, setStack] = useState([]);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const items = Array.isArray(children) ? children : children ? [children] : [];
    setStack(items);

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [children]);

  const handleDragEnd = useCallback(
    (_, info) => {
      if (Math.abs(info.offset.x) > sensitivity) {
        const direction = info.offset.x > 0 ? 'right' : 'left';
        onSwipe?.(0, direction);
        setStack((prev) => prev.slice(1));
      }
    },
    [sensitivity, onSwipe]
  );

  if (reducedMotion) {
    return (
      <div
        className={`stack-root${className ? ` ${className}` : ''}`}
        style={{ width: cardWidth }}
      >
        <ul className="stack-reduced-list">
          {stack.map((child, i) => (
            <li key={i} className="stack-reduced-item">
              {child}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const visibleCount = 3;

  return (
    <div
      className={`stack-root${className ? ` ${className}` : ''}`}
      style={{
        width: cardWidth,
        height: cardHeight,
        perspective: 800,
      }}
    >
      <AnimatePresence>
        {stack.slice(0, visibleCount).map((child, i) => {
          const isTop = i === 0;
          const offset = i * 8;
          const scale = 1 - i * 0.05;
          const opacity = 1 - i * 0.2;

          return (
            <motion.div
              key={i}
              className={`stack-card${isTop ? ' stack-card--top' : ' stack-card--behind'}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: visibleCount - i,
                transform: !isTop
                  ? `translateY(${offset}px) scale(${scale})`
                  : undefined,
                opacity: isTop ? 1 : opacity,
              }}
              drag={isTop && !mobileClickOnly ? 'x' : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.7}
              onDragEnd={isTop ? handleDragEnd : undefined}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: isTop ? 1 : opacity, scale, y: offset }}
              exit={{ x: 300, opacity: 0, rotate: 10 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              {child}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {stack.length === 0 && (
        <div className="stack-empty">No more cards</div>
      )}
    </div>
  );
};

export default Stack;
