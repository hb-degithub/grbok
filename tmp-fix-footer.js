const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// Update config/site.ts - remove problematic footer links, keep only about
const configPath = path.join(astroSrc, 'config', 'site.ts');
let config = fs.readFileSync(configPath, 'utf8');
config = config.replace(
  `footerLinks: [\n    { label: '友链申请', href: '/friend-links' },\n    { label: '免责声明', href: '/disclaimer' },\n    { label: '广告合作', href: '/ads' },\n    { label: '关于我们', href: '/about' },\n  ],`,
  `footerLinks: [\n    { label: '关于我们', href: '/about' },\n  ],`
);
fs.writeFileSync(configPath, config);
console.log('Updated footer links');

// Update index.astro - change 浏览文章 to 访问网站
const indexPath = path.join(astroSrc, 'pages', 'index.astro');
let index = fs.readFileSync(indexPath, 'utf8');
index = index.replace('浏览文章', '访问网站');
fs.writeFileSync(indexPath, index);
console.log('Updated hero CTA text');

// Update Footer.astro - add ICP icon, remove links section if empty
const footerPath = path.join(astroSrc, 'components', 'layout', 'Footer.astro');
let footer = fs.readFileSync(footerPath, 'utf8');

// Add icon before ICP link
footer = footer.replace(
  `<a href={SITE_CONFIG.icp.url} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-white">{SITE_CONFIG.icp.text}</a>`,
  `<a href={SITE_CONFIG.icp.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-white">\n            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>\n            {SITE_CONFIG.icp.text}\n          </a>`
);

footer = footer.replace(
  `<a href={SITE_CONFIG.police.url} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-white">{SITE_CONFIG.police.text}</a>`,
  `<a href={SITE_CONFIG.police.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-white">\n            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>\n            {SITE_CONFIG.police.text}\n          </a>`
);

fs.writeFileSync(footerPath, footer);
console.log('Updated Footer with ICP icons');
