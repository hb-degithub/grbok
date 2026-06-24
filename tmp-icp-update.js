const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// Update config/site.ts
const configPath = path.join(astroSrc, 'config', 'site.ts');
let config = fs.readFileSync(configPath, 'utf8');

config = config.replace(
  "description: 'Joe主题专为博客、自媒体、资讯类的网站设计开发，简约优雅的设计风格，全面的前端用户功能，简单的模块化配置。',",
  "description: '胡巴的个人博客，记录技术、思考与生活。',"
);

config = config.replace(
  "icp: '辽ICP备2025065723号-1',\n  police: '辽公网安备 21029602001076号',",
  `icp: { text: '辽ICP备2025065723号-1', url: 'https://beian.miit.gov.cn/' },
  police: { text: '辽公网安备 21029602001076号', url: 'http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=21029602001076' },`
);

fs.writeFileSync(configPath, config);
console.log('Updated site config');

// Update Footer.astro to render clickable ICP/police links
const footerPath = path.join(astroSrc, 'components', 'layout', 'Footer.astro');
let footer = fs.readFileSync(footerPath, 'utf8');

footer = footer.replace(
  `        <div class="mt-4 space-y-2 text-sm text-white/50">
          <p>{SITE_CONFIG.icp}</p>
          <p>{SITE_CONFIG.police}</p>
        </div>`,
  `        <div class="mt-4 space-y-2 text-sm text-white/50">
          <a href={SITE_CONFIG.icp.url} target="_blank" rel="noopener noreferrer" class="transition-colors hover:text-white">{SITE_CONFIG.icp.text}</a>
          <br />
          <a href={SITE_CONFIG.police.url} target="_blank" rel="noopener noreferrer" class="transition-colors hover:text-white">{SITE_CONFIG.police.text}</a>
        </div>`
);

fs.writeFileSync(footerPath, footer);
console.log('Updated Footer.astro');

// Update about.astro description reference if needed - it uses SITE_CONFIG.description so it will auto update
console.log('About page will auto-update from config');
