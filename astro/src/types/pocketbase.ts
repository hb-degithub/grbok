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

/**
 * 评论基础类型
 * 包含 PocketBase 数据库中的原始字段
 */
export interface Comment {
  id: string;
  post_id: string;
  author_name: string;
  author_email: string;
  content: string;
  parent_id: string | null;
  status: 'pending' | 'approved' | 'spam';
  ip_address: string;
  created: string;
  updated: string;
  expand?: {
    post_id?: Post;
    parent_id?: Comment;
  };
}

/**
 * 嵌套评论类型
 * 扩展 Comment 接口，添加递归的 children 结构
 * 用于在前端构建评论树
 */
export interface NestedComment extends Comment {
  /** 子评论列表（递归结构） */
  children: NestedComment[];
}

/**
 * Realtime 事件类型
 * PocketBase Realtime API 推送的事件格式
 */
export interface CommentRealtimeEvent {
  action: 'create' | 'update' | 'delete';
  record: Comment;
}

/**
 * 评论表单数据
 */
export interface CommentFormData {
  author_name: string;
  author_email: string;
  content: string;
  parent_id?: string | null;
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
