const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// Update global.css with modern animations and refined design tokens
const cssPath = path.join(astroSrc, 'styles', 'global.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Replace the theme section with modern tokens
const themeOld = `@theme {\n  --color-bg: #f5f6f8;\n  --color-bg-soft: #f0f1f4;\n  --color-surface: #ffffff;\n  --color-surface-hover: #fafafa;\n  --color-hero: #0f0f12;\n  --color-hero-soft: #1a1a1f;\n  --color-text: #1a1a2e;\n  --color-text-secondary: #5a5a6e;\n  --color-text-muted: #8a8a9a;\n  --color-border: #e8e8ed;\n  --color-border-strong: #d8d8e0;\n  --color-accent: #4f46e5;\n  --color-accent-hover: #4338ca;\n  --color-accent-soft: rgba(79, 70, 229, 0.08);\n  --color-success: #10b981;\n  --color-warning: #f59e0b;\n  --color-danger: #ef4444;`;

const themeNew = `@theme {\n  --color-bg: #f8f7f4;\n  --color-bg-soft: #f0eeea;\n  --color-surface: #ffffff;\n  --color-surface-hover: #fafaf8;\n  --color-hero: #0a0a0b;\n  --color-hero-soft: #141416;\n  --color-text: #1c1917;\n  --color-text-secondary: #78716c;\n  --color-text-muted: #a8a29e;\n  --color-border: #e7e5e4;\n  --color-border-strong: #d6d3d1;\n  --color-accent: #7c3aed;\n  --color-accent-hover: #6d28d9;\n  --color-accent-soft: rgba(124, 58, 237, 0.08);\n  --color-success: #10b981;\n  --color-warning: #f59e0b;\n  --color-danger: #ef4444;\n  --color-rose: #f43f5e;\n  --color-orange: #f97316;`;

css = css.replace(themeOld, themeNew);

// Append modern animations if not present
if (!css.includes('@keyframes hero-gradient')) {
  const modernAnimations = `

/* Modern entrance animations */
@keyframes hero-gradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

@keyframes float-slow {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-20px) rotate(2deg); }
}

@keyframes float-medium {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-12px) rotate(-1deg); }
}

@keyframes scale-in {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes letter-spacing-in {
  from { opacity: 0; letter-spacing: 0.3em; }
  to { opacity: 1; letter-spacing: -0.02em; }
}

@keyframes reveal-mask {
  from { clip-path: inset(0 100% 0 0); }
  to { clip-path: inset(0 0 0 0); }
}

@keyframes pulse-glow {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.05); }
}

@keyframes gradient-shift {
  0% { transform: translate(0, 0) rotate(0deg); }
  33% { transform: translate(30px, -30px) rotate(120deg); }
  66% { transform: translate(-20px, 20px) rotate(240deg); }
  100% { transform: translate(0, 0) rotate(360deg); }
}

.animate-hero-gradient {
  background-size: 400% 400%;
  animation: hero-gradient 15s ease infinite;
}

.animate-float-slow {
  animation: float-slow 8s ease-in-out infinite;
}

.animate-float-medium {
  animation: float-medium 6s ease-in-out infinite;
}

.animate-scale-in {
  animation: scale-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-slide-up {
  animation: slide-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  opacity: 0;
}

.animate-letter-spacing {
  animation: letter-spacing-in 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  opacity: 0;
}

.animate-reveal-mask {
  animation: reveal-mask 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-pulse-glow {
  animation: pulse-glow 4s ease-in-out infinite;
}

.animate-gradient-shift {
  animation: gradient-shift 20s linear infinite;
}

.delay-100 { animation-delay: 0.1s; }
.delay-200 { animation-delay: 0.2s; }
.delay-300 { animation-delay: 0.3s; }
.delay-400 { animation-delay: 0.4s; }
.delay-500 { animation-delay: 0.5s; }
.delay-600 { animation-delay: 0.6s; }
.delay-700 { animation-delay: 0.7s; }

/* Modern glass card */
.glass {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* Modern hover lift */
.hover-lift {
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.hover-lift:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.12);
}

/* Text gradient */
.text-gradient {
  background: linear-gradient(135deg, #ffffff 0%, #d8b4fe 50%, #f9a8d4 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
`;
  css = css + modernAnimations;
}

fs.writeFileSync(cssPath, css);
console.log('Updated global.css with modern tokens and animations');
