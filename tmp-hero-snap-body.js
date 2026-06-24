const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// Put snap back on BaseLayout body
const baseLayoutPath = path.join(astroSrc, 'layouts', 'BaseLayout.astro');
let baseLayout = fs.readFileSync(baseLayoutPath, 'utf8');
if (!baseLayout.includes('snap-y snap-mandatory')) {
  baseLayout = baseLayout.replace(
    '<body class="min-h-screen bg-bg font-body text-text antialiased">',
    '<body class="min-h-screen snap-y snap-mandatory bg-bg font-body text-text antialiased">'
  );
  fs.writeFileSync(baseLayoutPath, baseLayout);
  console.log('Added scroll snap to BaseLayout body');
}

// Remove the inner wrapper from index.astro since body is the snap container
let index = fs.readFileSync(path.join(astroSrc, 'pages', 'index.astro'), 'utf8');
if (index.includes('class="snap-y snap-mandatory"')) {
  index = index.replace('  <div class="snap-y snap-mandatory">\n', '');
  // Remove the matching closing div
  const lastClosingDiv = index.lastIndexOf('  </div>\n</BaseLayout>');
  if (lastClosingDiv !== -1) {
    index = index.slice(0, lastClosingDiv) + index.slice(lastClosingDiv + '  </div>\n'.length);
  }
  fs.writeFileSync(path.join(astroSrc, 'pages', 'index.astro'), index);
  console.log('Removed inner snap wrapper');
}
