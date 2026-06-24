const fs = require('fs');
const path = require('path');

const cssPath = path.join('H:', '开发', '个人博客', 'astro', 'src', 'styles', 'global.css');
let css = fs.readFileSync(cssPath, 'utf8');

const holoCardOld = /\.holo-card \{[\s\S]*?\n\}/;
const holoCardNew = `.holo-card {
  position: relative;
  background: rgba(8, 9, 13, 0.55);
  border: 1px solid rgba(34, 211, 238, 0.15);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: all var(--duration-normal) var(--ease-out-expo);
  overflow: hidden;
}

.holo-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.15), transparent 50%, rgba(251, 191, 36, 0.08));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  opacity: 0.6;
  transition: opacity var(--duration-normal) ease;
}

.holo-card:hover::before {
  opacity: 1;
}

.holo-card:hover {
  border-color: rgba(34, 211, 238, 0.35);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5), 0 0 24px rgba(34, 211, 238, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  transform: translateY(-2px);
}`;

if (holoCardOld.test(css)) {
  css = css.replace(holoCardOld, holoCardNew);
  console.log('Updated holo-card');
} else {
  console.log('holo-card not found, appending');
  css = css + '\n' + holoCardNew + '\n';
}

if (!css.includes('.glass-strong')) {
  const glassStrong = `
/* 强毛玻璃面板 */
.glass-strong {
  background: rgba(8, 9, 13, 0.72);
  border: 1px solid rgba(34, 211, 238, 0.2);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

/* 毛玻璃模态遮罩 */
.glass-overlay {
  background: rgba(3, 3, 5, 0.65);
  backdrop-filter: blur(12px) saturate(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
}

/* 毛玻璃输入框 */
.glass-input {
  background: rgba(8, 9, 13, 0.6);
  border: 1px solid rgba(34, 211, 238, 0.15);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: all var(--duration-normal) ease;
}

.glass-input:focus {
  border-color: rgba(34, 211, 238, 0.4);
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.12), 0 0 20px rgba(34, 211, 238, 0.08);
  background: rgba(8, 9, 13, 0.75);
}
`;
  css = css + glassStrong;
  console.log('Added glass classes');
}

fs.writeFileSync(cssPath, css);
console.log('global.css done');
