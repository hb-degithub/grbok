const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

let index = fs.readFileSync(path.join(astroSrc, 'pages', 'index.astro'), 'utf8');

// Replace hero section min-height with full screen and add scroll snap
index = index.replace(
  '<section class="relative flex min-h-[620px] items-center justify-center overflow-hidden bg-hero px-4 sm:min-h-[720px]">',
  '<section class="relative flex h-screen min-h-[600px] items-center justify-center overflow-hidden bg-hero px-4">'
);

// Update scroll indicator text/icon
index = index.replace(
  `    <!-- Scroll indicator -->
    <div class="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce text-white/30">
      <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </div>`,
  `    <!-- Scroll indicator -->
    <div class="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/30 animate-bounce">
      <span class="text-[10px] font-medium uppercase tracking-[0.2em]">向上滑动</span>
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </div>`
);

// Add scroll snap wrapper if not present
if (!index.includes('scroll-smooth')) {
  index = index.replace(
    '<BaseLayout title="首页" description={SITE_CONFIG.slogan}>',
    '<BaseLayout title="首页" description={SITE_CONFIG.slogan}>'
  );
}

fs.writeFileSync(path.join(astroSrc, 'pages', 'index.astro'), index);
console.log('Updated hero to full screen');
