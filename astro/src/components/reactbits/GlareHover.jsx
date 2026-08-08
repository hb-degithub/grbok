import './GlareHover.css';

const GlareHover = ({
  children,
  className = '',
  glareColor = 'rgba(255,255,255,0.12)',
}) => {
  return (
    <div
      className={`glarehover-root${className ? ` ${className}` : ''}`}
      style={{ '--glare-color': glareColor }}
    >
      {children}
    </div>
  );
};

export default GlareHover;
