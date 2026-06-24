const fs = require('fs');
const path = require('path');

const cssPath = path.join('H:', '开发', '个人博客', 'astro', 'src', 'styles', 'global.css');
let css = fs.readFileSync(cssPath, 'utf8');

if (!css.includes('transition: transform 0.4s cubic-bezier')) {
  css = css.replace(
    '.card:hover {\n  border-color: var(--color-border-strong);\n  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);\n}',
    '.card {\n  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.3s ease;\n}\n\n.card:hover {\n  border-color: var(--color-border-strong);\n  transform: translateY(-3px);\n  box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.08);\n}'
  );
  fs.writeFileSync(cssPath, css);
  console.log('Updated card hover effects');
} else {
  console.log('Card hover already updated');
}
