const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// Remove global snap from BaseLayout
const baseLayoutPath = path.join(astroSrc, 'layouts', 'BaseLayout.astro');
let baseLayout = fs.readFileSync(baseLayoutPath, 'utf8');
if (baseLayout.includes('snap-y snap-mandatory')) {
  baseLayout = baseLayout.replace('snap-y snap-mandatory ', '');
  fs.writeFileSync(baseLayoutPath, baseLayout);
  console.log('Removed global scroll snap from BaseLayout');
}

// Add snap wrapper to index.astro homepage only
let index = fs.readFileSync(path.join(astroSrc, 'pages', 'index.astro'), 'utf8');

// Wrap Hero + Main Content in a snap container
if (!index.includes('class="snap-y snap-mandatory"')) {
  index = index.replace(
    '<BaseLayout title="首页" description={SITE_CONFIG.slogan}>',
    '<BaseLayout title="首页" description={SITE_CONFIG.slogan}>\n  <div class="snap-y snap-mandatory">'
  );
  index = index.replace(
    '</BaseLayout>',
    '  </div>\n</BaseLayout>'
  );
  fs.writeFileSync(path.join(astroSrc, 'pages', 'index.astro'), index);
  console.log('Added homepage-only scroll snap wrapper');
}
