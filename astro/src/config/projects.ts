// 项目展示页数据：改项目就编辑这个文件（硬编码决策，无后端）。
export interface ProjectLink {
  /** 在线访问地址 */
  demo?: string;
  /** 仓库地址 */
  github?: string;
  /** 站内相关文章路径（如 /posts/xxx） */
  article?: string;
}

export interface Project {
  /** 项目名称 */
  name: string;
  /** 一句话标语 */
  tagline: string;
  /** 项目描述（1-2 句） */
  description: string;
  /** 技术栈标签 */
  tech: string[];
  /** active=运营中 / wip=开发中 / archived=已归档 */
  status: 'active' | 'wip' | 'archived';
  links: ProjectLink;
  /** featured 项目显示在顶部大卡片区 */
  featured?: boolean;
}

export const projects: Project[] = [
  {
    name: '胡巴的博客',
    tagline: '自建全栈个人博客系统',
    description:
      'Astro 7 SSR 服务端渲染 + React 19 岛屿 + PocketBase 0.22 后端的全栈博客：RBAC 管理员体系、TOTP 身份验证器、评论系统、Pagefind 全文搜索、访问统计、Docker Compose 一体化部署。',
    tech: ['Astro 7 SSR', 'React 19', 'Tailwind CSS 4', 'PocketBase 0.22', 'admin-auth', 'Caddy 2.8', 'Docker Compose'],
    status: 'active',
    links: { demo: 'https://hlydwz.com', article: '/posts' },
    featured: true,
  },
];
