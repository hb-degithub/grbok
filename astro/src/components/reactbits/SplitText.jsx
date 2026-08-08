import { motion, useReducedMotion } from 'framer-motion';
import './SplitText.css';

const SplitText = ({
  text,
  className = '',
  delay = 0,
  staggerDelay = 0.03,
  as = 'span',
}) => {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    const Tag = as;
    return (
      <Tag className={`splittext${className ? ` ${className}` : ''}`} aria-label={text}>
        {text}
      </Tag>
    );
  }

  const Tag = motion[as] || motion.span;

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
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: 'spring',
        damping: 20,
        stiffness: 150,
      },
    },
  };

  const chars = text.split('');

  return (
    <Tag
      className={`splittext${className ? ` ${className}` : ''}`}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      aria-label={text}
    >
      {chars.map((char, i) =>
        char === ' ' ? (
          <motion.span
            key={`space-${i}`}
            className="splittext__char"
            variants={charVariants}
            aria-hidden="true"
          >
            &nbsp;
          </motion.span>
        ) : (
          <motion.span
            key={`char-${i}`}
            className="splittext__char"
            variants={charVariants}
          >
            {char}
          </motion.span>
        )
      )}
    </Tag>
  );
};

export default SplitText;
