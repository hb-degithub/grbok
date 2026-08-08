import { useState, useEffect, useCallback, useRef, Children } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './Carousel.css';

const Carousel = ({
  children,
  autoplay = true,
  autoplayInterval = 3000,
  loop = true,
  className = '',
}) => {
  const slides = Children.toArray(children);
  const count = slides.length;
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(1);
  const dragStartX = useRef(0);
  const autoplayRef = useRef(null);
  const paused = useRef(false);

  const wrapIndex = useCallback(
    (i) => {
      if (!loop) return Math.max(0, Math.min(i, count - 1));
      return ((i % count) + count) % count;
    },
    [count, loop],
  );

  const goTo = useCallback(
    (i, dir) => {
      setDirection(dir ?? (i > current ? 1 : -1));
      setCurrent(wrapIndex(i));
    },
    [current, wrapIndex],
  );

  const next = useCallback(() => goTo(current + 1, 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1, -1), [current, goTo]);

  // Autoplay
  useEffect(() => {
    if (!autoplay || count <= 1) return;
    const tick = () => {
      if (!paused.current) next();
    };
    autoplayRef.current = setInterval(tick, autoplayInterval);
    return () => clearInterval(autoplayRef.current);
  }, [autoplay, autoplayInterval, next, count]);

  // Pause autoplay on hover / focus
  const pause = () => { paused.current = true; };
  const resume = () => { paused.current = false; };

  // Drag handlers
  const handleDragStart = (_, info) => {
    pause();
    dragStartX.current = info.point.x;
  };

  const handleDragEnd = (_, info) => {
    const offset = info.offset.x;
    const velocity = info.velocity.x;
    const threshold = 50;

    if (offset < -threshold || velocity < -300) {
      next();
    } else if (offset > threshold || velocity > 300) {
      prev();
    }
    resume();
  };

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowRight') next();
  };

  if (count === 0) return null;

  const variants = {
    enter: (dir) => ({
      x: dir > 0 ? '100%' : '-100%',
      rotateY: dir > 0 ? 45 : -45,
      opacity: 0,
      scale: 0.85,
    }),
    center: {
      x: '0%',
      rotateY: 0,
      opacity: 1,
      scale: 1,
    },
    exit: (dir) => ({
      x: dir > 0 ? '-100%' : '100%',
      rotateY: dir > 0 ? -45 : 45,
      opacity: 0,
      scale: 0.85,
    }),
  };

  return (
    <div
      className={`carousel-root${className ? ` ${className}` : ''}`}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-roledescription="carousel"
      aria-label="Image carousel"
    >
      <div className="carousel-viewport">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={current}
            className="carousel-slide"
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: 'spring', stiffness: 300, damping: 30 },
              rotateY: { duration: 0.4, ease: 'easeOut' },
              opacity: { duration: 0.3 },
              scale: { duration: 0.3 },
            }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.3}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            style={{ perspective: 800 }}
          >
            {slides[current]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Arrow buttons */}
      {count > 1 && (
        <>
          <button
            className="carousel-arrow carousel-arrow--prev"
            onClick={prev}
            aria-label="Previous slide"
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            className="carousel-arrow carousel-arrow--next"
            onClick={next}
            aria-label="Next slide"
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
        </>
      )}

      {/* Dots */}
      {count > 1 && (
        <div className="carousel-dots" role="tablist" aria-label="Slide indicators">
          {slides.map((_, i) => (
            <button
              key={i}
              className={`carousel-dot${i === current ? ' carousel-dot--active' : ''}`}
              onClick={() => goTo(i)}
              role="tab"
              aria-selected={i === current}
              aria-label={`Slide ${i + 1}`}
              type="button"
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Carousel;
