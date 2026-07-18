// 文章页滚动动效：标题随滚动淡出缩小、封面轻微视差。
// 通过 astro:page-load / astro:before-swap 适配 ClientRouter 客户端导航。
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let ctx: gsap.Context | undefined;

function setup() {
  ctx?.revert();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  ctx = gsap.context(() => {
    const header = document.querySelector('.post-hero');
    const title = document.querySelector('.post-title');
    if (header && title) {
      gsap.to(title, {
        opacity: 0.25,
        scale: 0.96,
        transformOrigin: 'left top',
        ease: 'none',
        scrollTrigger: {
          trigger: header,
          start: 'top top+=96',
          end: 'bottom top+=160',
          scrub: true,
        },
      });
    }

    const coverImg = document.querySelector('.post-cover img');
    if (coverImg) {
      gsap.fromTo(
        coverImg,
        { yPercent: -5, scale: 1.08 },
        {
          yPercent: 5,
          scale: 1.08,
          ease: 'none',
          scrollTrigger: {
            trigger: '.post-cover',
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
          },
        },
      );
    }
  });
}

setup();
document.addEventListener('astro:page-load', setup);
document.addEventListener('astro:before-swap', () => ctx?.revert());
