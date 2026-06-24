const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

let index = fs.readFileSync(path.join(astroSrc, 'pages', 'index.astro'), 'utf8');

// Fix malformed strokeWidth
index = index.replace('strokeWidth={1.5"', 'strokeWidth={1.5}');

// Update scroll indicator
index = index.replace(
  `    <!-- Scroll indicator -->
    <div class="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/30 animate-bounce">
      <span class="text-[10px] font-medium uppercase tracking-[0.2em]">向上滑动</span>
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </div>`,
  `    <!-- Scroll indicator -->
    <div class="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/30 animate-bounce">
      <span class="text-[10px] font-medium uppercase tracking-[0.2em]">向上滑动</span>
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </div>`
);

// Add snap classes to hero and content
index = index.replace(
  '<section class="relative flex h-screen min-h-[600px] items-center justify-center overflow-hidden bg-hero px-4">',
  '<section class="relative flex h-screen min-h-[600px] snap-start snap-always items-center justify-center overflow-hidden bg-hero px-4">'
);
index = index.replace(
  '<!-- Main Content -->\n  <section id="latest" class="mx-auto max-w-7xl px-4 py-20 sm:px-6">',
  '<!-- Main Content -->\n  <section id="latest" class="mx-auto max-w-7xl snap-start snap-always px-4 py-20 sm:px-6">'
);

fs.writeFileSync(path.join(astroSrc, 'pages', 'index.astro'), index);
console.log('Fixed SVG and added scroll snap classes');

// Add scroll snap to BaseLayout body
const baseLayoutPath = path.join(astroSrc, 'layouts', 'BaseLayout.astro');
let baseLayout = fs.readFileSync(baseLayoutPath, 'utf8');
if (!baseLayout.includes('snap-y snap-mandatory')) {
  baseLayout = baseLayout.replace(
    '<body class="min-h-screen bg-bg font-body text-text antialiased">',
    '<body class="min-h-screen snap-y snap-mandatory bg-bg font-body text-text antialiased">'
  );
  fs.writeFileSync(baseLayoutPath, baseLayout);
  console.log('Added scroll snap to BaseLayout');
}
