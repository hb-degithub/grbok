/**
 * 站点配置
 * 修改此处即可替换 logo、头像、备案号、友链等
 */

export const SITE_CONFIG = {
  name: '胡巴的博客',
  slogan: '分享技术、思考与生活',
  badge: 'PERSONAL LOG // 持续更新中',
  description: '胡巴的个人博客，记录技术、思考与生活。',
  logo: '/favicon.svg',
  logoText: '胡',
  avatar: '/favicon.svg',
  author: 'HB',
  authorBio: '这家伙很懒，什么都没有写...',
  since: '2022',
  icp: { text: '辽ICP备2025065723号-1', url: 'https://beian.miit.gov.cn/' },
  police: { text: '辽公网安备21029602001076号', url: 'http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=21029602001076' },
  footerLinks: [
    { label: '关于我们', href: '/about' },
  ],
  friendLinks: [
    { name: '易航博客', url: 'https://example.com' },
    { name: 'Joe主题', url: 'https://example.com' },
  ],
  socialLinks: [
    { name: 'github', url: 'https://github.com' },
    { name: 'twitter', url: 'https://twitter.com' },
  ],
} as const;

export const HERO_CARDS = [
  { label: 'Articles', countKey: 'posts', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' },
  { label: 'Tags', countKey: 'tags', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
] as const;