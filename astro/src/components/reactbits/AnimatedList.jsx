import { Children, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './AnimatedList.css';

const AnimatedList = ({
  children,
  showGradients = true,
  gradientColor,
  itemDelay = 0.05,
  className,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef(null);
  const [isTopVisible, setIsTopVisible] = useState(true);
  const [isBottomVisible, setIsBottomVisible] = useState(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setIsTopVisible(el.scrollTop <= 1);
    setIsBottomVisible(el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  }, []);

  const defaultGradientColor = gradientColor || 'var(--animatedlist-gradient-color, #fafafa)';

  const childArray = Children.toArray(children);

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: (i) => ({
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.4,
        delay: i * itemDelay,
        ease: [0.16, 1, 0.3, 1],
      },
    }),
  };

  return (
    <div
      className={`animatedlist-root${className ? ` ${className}` : ''}`}
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        '--animatedlist-gradient-color': defaultGradientColor,
      }}
    >
      {showGradients && !isTopVisible && (
        <div className="animatedlist-gradient-top" aria-hidden="true" />
      )}

      {childArray.map((child, index) =>
        prefersReducedMotion ? (
          <div key={index} className="animatedlist-item">
            {child}
          </div>
        ) : (
          <motion.div
            key={index}
            className="animatedlist-item"
            variants={itemVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.1 }}
            custom={index}
          >
            {child}
          </motion.div>
        )
      )}

      {showGradients && !isBottomVisible && (
        <div className="animatedlist-gradient-bottom" aria-hidden="true" />
      )}
    </div>
  );
};

export default AnimatedList;
