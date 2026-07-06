import { useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import './SpotlightCard.css';

const SpotlightCard = ({
  children,
  className,
  spotlightColor = 'rgba(20, 184, 166, 0.12)',
  spotlightSize = 200,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e) => {
    if (prefersReducedMotion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setPosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseEnter = () => {
    if (!prefersReducedMotion) {
      setIsHovered(true);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const handleTouchStart = (e) => {
    if (prefersReducedMotion) return;
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    setPosition({
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    });
    setIsHovered(true);
  };

  const handleTouchMove = (e) => {
    if (prefersReducedMotion) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    setPosition({
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    });
  };

  const handleTouchEnd = (e) => {
    e.stopPropagation();
    setIsHovered(false);
  };

  return (
    <div
      className={`spotlightcard${className ? ` ${className}` : ''}`}
      style={{
        '--spotlight-x': `${position.x}px`,
        '--spotlight-y': `${position.y}px`,
        '--spotlight-opacity': isHovered ? 1 : 0,
        '--spotlight-color': spotlightColor,
        '--spotlight-size': `${spotlightSize}px`,
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="spotlightcard__overlay" />
      <div className="spotlightcard__content">{children}</div>
    </div>
  );
};

export default SpotlightCard;
