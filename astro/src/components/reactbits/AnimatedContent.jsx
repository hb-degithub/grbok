import { motion, useReducedMotion } from 'framer-motion';
import './AnimatedContent.css';

const AnimatedContent = ({
  children,
  className,
  distance = 20,
  delay = 0,
  duration = 0.6,
  direction = 'up',
}) => {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return (
      <div className={`animatedcontent${className ? ` ${className}` : ''}`}>
        {children}
      </div>
    );
  }

  const yDirection = direction === 'up' ? 1 : -1;

  return (
    <motion.div
      className={`animatedcontent${className ? ` ${className}` : ''}`}
      initial={{
        opacity: 0,
        filter: 'blur(8px)',
        y: distance * yDirection,
      }}
      whileInView={{
        opacity: 1,
        filter: 'blur(0px)',
        y: 0,
      }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{
        duration,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </motion.div>
  );
};

export default AnimatedContent;
