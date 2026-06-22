/**
 * PocketBase 数据类型定义
 * 基于 docs/pocketbase-schema.md 生成
 */

/** 用户 */
export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string;
  role: 'admin' | 'author' | 'reader';
  bio: string;
  created: string;
  updated: string;
}

/** 文章 */
export interface Post {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  cover: string;
  status: 'draft' | 'published' | 'archived';
  author: string;
  published_at: string;
  views: number;
  created: string;
  updated: string;
  expand?: {
    author?: User;
    'post_tags(post_id)'?: PostTag[];
  };
}

/** 评论 */
export interface Comment {
  id: string;
  post_id: string;
  author_name: string;
  author_email: string;
  content: string;
  parent_id: string;
  status: 'pending' | 'approved' | 'spam';
  ip_address: string;
  created: string;
  updated: string;
  expand?: {
    post_id?: Post;
    parent_id?: Comment;
  };
}

/** 标签 */
export interface Tag {
  id: string;
  name: string;
  slug: string;
  description: string;
  created: string;
  updated: string;
}

/** 文章-标签关联 */
export interface PostTag {
  id: string;
  post_id: string;
  tag_id: string;
  created: string;
  updated: string;
  expand?: {
    post_id?: Post;
    tag_id?: Tag;
  };
}

/** 站点设置 */
export interface Setting {
  id: string;
  key: string;
  value: unknown;
  description: string;
  created: string;
  updated: string;
}
