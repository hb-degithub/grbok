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
      'Astro 群岛架构前端 + PocketBase 后端的全栈博客：RBAC 管理员体系、TOTP 身份验证器、评论系统、全文搜索、访问统计、Docker 一体化部署。',
    tech: ['Astro 6', 'React 19', 'Tailwind CSS 4', 'PocketBase', 'Docker', 'Caddy'],
    status: 'active',
    links: { demo: 'https://hlydwz.com', article: '/posts' },
    featured: true,
  },
  {
    name: '示例项目 Alpha',
    tagline: '示例项目，请编辑 src/config/projects.ts',
    description: '这是一个占位项目。把这里换成你的项目：名称、标语、描述、技术栈和链接。',
    tech: ['示例', '占位'],
    status: 'wip',
    links: {},
  },
  {
    name: '示例项目 Beta',
    tagline: '示例项目，请编辑 src/config/projects.ts',
    description: '再一个占位项目。featured: true 可以让项目显示在顶部大卡片区。',
    tech: ['示例'],
    status: 'archived',
    links: {},
  },
];
