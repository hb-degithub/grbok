import { motion, useReducedMotion } from 'framer-motion';
import './ScrollFloat.css';

const ScrollFloat = ({
  children,
  text,
  className,
  delay = 0,
  duration = 0.8,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const staggerDelay = 0.03;

  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: staggerDelay,
        delayChildren: delay,
      },
    },
  };

  const charVariants = {
    hidden: { opacity: 0, y: 40 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  };

  // Respects prefers-reduced-motion: show text immediately without animation
  if (prefersReducedMotion) {
    if (text) {
      return (
        <span className={`scrollfloat-root${className ? ` ${className}` : ''}`} aria-label={text}>
          {text}
        </span>
      );
    }
    return (
      <span className={`scrollfloat-root${className ? ` ${className}` : ''}`}>
        {children}
      </span>
    );
  }

  // If text prop is provided, split into characters and animate each
  if (text) {
    const chars = text.split('');

    return (
      <motion.span
        className={`scrollfloat-root${className ? ` ${className}` : ''}`}
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        aria-label={text}
      >
        {chars.map((char, i) =>
          char === ' ' ? (
            <motion.span
              key={`space-${i}`}
              className="scrollfloat-char"
              variants={charVariants}
              aria-hidden="true"
            >
              &nbsp;
            </motion.span>
          ) : (
            <motion.span
              key={`char-${i}`}
              className="scrollfloat-char"
              variants={charVariants}
            >
              {char}
            </motion.span>
          )
        )}
      </motion.span>
    );
  }

  // Otherwise animate children as a block
  return (
    <motion.span
      className={`scrollfloat-root${className ? ` ${className}` : ''}`}
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{
        duration,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </motion.span>
  );
};

export default ScrollFloat;
