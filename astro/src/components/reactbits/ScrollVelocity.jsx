import { useRef, useEffect, useState } from 'react';
import { motion, useScroll, useSpring, useMotionValue, useVelocity } from 'framer-motion';
import useBreakpoint from '../../hooks/useBreakpoint';
import './ScrollVelocity.css';

const wrap = (min, max, v) => {
  const range = max - min;
  return ((((v - min) % range) + range) % range) + min;
};

const ScrollingRow = ({ text, baseVelocity, scrollVelocity, scrollVelocityMultiplier, direction, className = '' }) => {
  const baseX = useMotionValue(0);
  const [repetitions, setRepetitions] = useState(4);
  const rowRef = useRef(null);

  // Calculate how many repetitions fill the container
  useEffect(() => {
    if (!rowRef.current) return;
    const rowWidth = rowRef.current.scrollWidth / repetitions;
    const containerWidth = rowRef.current.parentElement?.offsetWidth || window.innerWidth;
    const needed = Math.ceil(containerWidth / rowWidth) + 2;
    if (needed > repetitions) {
      setRepetitions(needed);
    }
  }, [text, repetitions]);

  // Animate: combine base velocity with scroll velocity boost
  useEffect(() => {
    let prev = baseX.get();
    let animationFrame;
    let cachedSetWidth = 0;

    const measureSetWidth = () => {
      if (!rowRef.current) return 0;
      return rowRef.current.scrollWidth / repetitions;
    };
    cachedSetWidth = measureSetWidth();

    const step = () => {
      if (document.hidden) {
        prev = baseX.get();
        animationFrame = requestAnimationFrame(step);
        return;
      }
      const current = baseX.get();
      const totalVelocity = baseVelocity + scrollVelocity.get() * scrollVelocityMultiplier;
      const directionSign = direction === 'left' ? -1 : 1;
      const next = current + totalVelocity * directionSign;

      // Use cached width; re-measure only if zero (not yet laid out)
      let singleSetWidth = cachedSetWidth;
      if (singleSetWidth <= 0) {
        singleSetWidth = measureSetWidth();
        cachedSetWidth = singleSetWidth;
      }

      if (singleSetWidth > 0) {
        baseX.set(wrap(-singleSetWidth, 0, next));
      } else {
        baseX.set(next);
      }

      prev = current;
      animationFrame = requestAnimationFrame(step);
    };

    animationFrame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrame);
  }, [baseVelocity, scrollVelocity, scrollVelocityMultiplier, direction, repetitions, baseX]);

  return (
    <div className={`scrollvelocity-row${className ? ` ${className}` : ''}`}>
      <motion.div
        ref={rowRef}
        className="scrollvelocity-track"
        style={{ x: baseX }}
      >
        {Array.from({ length: repetitions }).map((_, i) => (
          <span key={i} className="scrollvelocity-text">
            {text}
          </span>
        ))}
      </motion.div>
    </div>
  );
};

const ScrollVelocity = ({
  text,
  className = '',
  baseVelocity = 2,
  scrollVelocityMultiplier = 0.5,
}) => {
  const { isMobile } = useBreakpoint();
  const containerRef = useRef(null);

  // Track scroll velocity using framer-motion
  const { scrollY } = useScroll();
  const scrollYVelocity = useVelocity(scrollY);
  const smoothVelocity = useSpring(scrollYVelocity, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  // Mobile: return null
  if (isMobile) return null;

  return (
    <div
      ref={containerRef}
      className={`scrollvelocity-root${className ? ` ${className}` : ''}`}
    >
      <ScrollingRow
        text={text}
        baseVelocity={baseVelocity}
        scrollVelocity={smoothVelocity}
        scrollVelocityMultiplier={scrollVelocityMultiplier}
        direction="left"
      />
      <ScrollingRow
        text={text}
        baseVelocity={baseVelocity}
        scrollVelocity={smoothVelocity}
        scrollVelocityMultiplier={scrollVelocityMultiplier}
        direction="right"
      />
    </div>
  );
};

export default ScrollVelocity;
