import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';

const CountUp = ({
  from = 0,
  to,
  duration = 1.5,
  delay = 0,
  className,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const motionValue = useMotionValue(from);
  const springValue = useSpring(motionValue, {
    duration: duration * 1000,
    bounce: 0,
  });
  const displayValue = useTransform(springValue, (v) => Math.round(v));
  const hasAnimated = useRef(false);
  const spanRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (hasAnimated.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const timeout = setTimeout(() => {
            motionValue.set(to);
          }, delay * 1000);
          return () => clearTimeout(timeout);
        }
      },
      { threshold: 0.3 }
    );

    if (spanRef.current) {
      observer.observe(spanRef.current);
    }

    return () => observer.disconnect();
  }, [motionValue, to, delay, prefersReducedMotion]);

  if (prefersReducedMotion) {
    return (
      <span
        ref={spanRef}
        className={className}
        style={{ display: 'inline-block', fontVariantNumeric: 'tabular-nums' }}
      >
        {to}
      </span>
    );
  }

  return (
    <motion.span
      ref={spanRef}
      className={className}
      style={{ display: 'inline-block', tabularNums: true, fontVariantNumeric: 'tabular-nums' }}
    >
      {displayValue}
    </motion.span>
  );
};

export default CountUp;
