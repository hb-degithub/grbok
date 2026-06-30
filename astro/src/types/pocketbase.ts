export type UserRole = 'reader' | 'author' | 'admin' | 'super_admin';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string;
  role: UserRole;
  bio: string;
  created: string;
  updated: string;
}

export interface ReaderRegisterData {
  email: string;
  password: string;
  passwordConfirm: string;
  name?: string;
  role: 'reader';
}

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
  is_pinned?: boolean;
  is_featured?: boolean;
  seo_title?: string;
  seo_description?: string;
  seo_keywords?: string;
  created: string;
  updated: string;
  expand?: {
    author?: User;
    'post_tags(post_id)'?: PostTag[];
  };
}

export interface PublicComment {
  id: string;
  post_id: string;
  author_name: string;
  content: string;
  parent_id: string | null;
  status: 'pending' | 'approved' | 'spam';
  created: string;
  updated: string;
  expand?: {
    post_id?: Post;
    parent_id?: PublicComment;
  };
}

export interface Comment extends PublicComment {
  author_email: string;
  status: 'pending' | 'approved' | 'spam';
  ip_address: string;
  expand?: {
    post_id?: Post;
    parent_id?: Comment;
  };
}

export interface NestedComment extends PublicComment {
  children: NestedComment[];
}

export interface CommentRealtimeEvent {
  action: 'create' | 'update' | 'delete';
  record: PublicComment;
}

export interface CommentFormData {
  author_name: string;
  author_email: string;
  content: string;
  parent_id?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  description: string;
  created: string;
  updated: string;
}

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

export interface Setting {
  id: string;
  key: string;
  value: unknown;
  description: string;
  created: string;
  updated: string;
}


export interface FriendLink {
  id: string;
  name: string;
  url: string;
  description?: string;
  avatar?: string;
  status: 'show' | 'hide';
  sort_order?: number;
  created: string;
  updated: string;
}

export interface Announcement {
  id: string;
  title?: string;
  content: string;
  type: 'normal' | 'info' | 'warning' | 'important';
  enabled?: boolean;
  start_at?: string;
  end_at?: string;
  created: string;
  updated: string;
}
