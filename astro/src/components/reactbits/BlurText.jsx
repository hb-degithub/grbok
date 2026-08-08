import { motion, useReducedMotion } from 'framer-motion';

const BlurText = ({
  text,
  className = '',
  delay = 0,
  duration = 0.6,
  blurAmount = 8,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const staggerDelay = 0.04;

  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: staggerDelay,
        delayChildren: delay,
      },
    },
  };

  const wordVariants = {
    hidden: {
      opacity: 0,
      filter: `blur(${blurAmount}px)`,
    },
    visible: {
      opacity: 1,
      filter: 'blur(0px)',
      transition: {
        duration,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  };

  const words = text.split(' ');

  // Respects prefers-reduced-motion: show text immediately without animation
  if (prefersReducedMotion) {
    return (
      <span className={className} aria-label={text}>
        {text}
      </span>
    );
  }

  return (
    <motion.span
      className={className}
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
      aria-label={text}
      style={{ display: 'inline-flex', flexWrap: 'wrap' }}
    >
      {words.map((word, i) => (
        <motion.span
          key={`word-${i}`}
          variants={wordVariants}
          style={{
            display: 'inline-block',
            marginRight: '0.25em',
            willChange: 'filter, opacity',
          }}
        >
          {word}
        </motion.span>
      ))}
    </motion.span>
  );
};

export default BlurText;
