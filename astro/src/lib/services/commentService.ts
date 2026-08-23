import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';
import type { PublicComment, NestedComment, CommentFormData, CommentRealtimeEvent } from '../../types/pocketbase';

const PUBLIC_COMMENT_FIELDS = 'id,post_id,author_name,content,parent_id,status,created,updated,likes,edited,edited_at,deleted,author_level';

interface CommentRecord extends RecordModel {
  post_id: string;
  author_name: string;
  author_email: string;
  content: string;
  parent_id: string | null;
  status: string;
}

class CommentService extends BaseService<CommentRecord> {
  constructor() {
    super('comments');
  }

  /**
   * 获取文章的公开评论列表（分页）
   */
  async getPublicComments(postId: string, page = 1, perPage = 20): Promise<{ items: PublicComment[]; totalItems: number; totalPages: number }> {
    const pb = this.getPocketBase();
    const result = await pb.collection('public_comments').getList<PublicComment>(page, perPage, {
      filter: pb.filter('post_id = {:postId} && deleted = false', { postId }),
      sort: '-created',
      fields: PUBLIC_COMMENT_FIELDS,
    });
    return {
      items: result.items,
      totalItems: result.totalItems,
      totalPages: result.totalPages,
    };
  }

  /**
   * 获取文章的公开评论列表（兼容旧版，一次性加载）
   */
  async getAllPublicComments(postId: string): Promise<PublicComment[]> {
    const pb = this.getPocketBase();
    return pb.collection('public_comments').getFullList<PublicComment>({
      filter: pb.filter('post_id = {:postId} && deleted = false', { postId }),
      sort: '-created',
      fields: PUBLIC_COMMENT_FIELDS,
    });
  }

  /**
   * 提交评论
   */
  async submitComment(postId: string, data: CommentFormData): Promise<CommentRecord> {
    const pb = this.getPocketBase();
    return pb.collection('comments').create<CommentRecord>({
      post_id: postId,
      author_name: data.author_name,
      author_email: data.author_email,
      content: data.content,
      parent_id: data.parent_id || null,
    });
  }

  /**
   * 订阅公开评论的实时更新
   */
  async subscribeToPublicComments(
    callback: (event: CommentRealtimeEvent) => void
  ): Promise<() => void> {
    const pb = this.getPocketBase();
    return pb.collection('public_comments').subscribe('*', (e) => {
      callback({
        action: e.action as 'create' | 'update' | 'delete',
        record: e.record as unknown as PublicComment,
      });
    });
  }

  /**
   * 将扁平评论列表构建为树形结构
   */
  buildCommentTree(flatComments: PublicComment[]): NestedComment[] {
    const commentMap = new Map<string, NestedComment>();
    const rootComments: NestedComment[] = [];

    flatComments.forEach((comment) => {
      commentMap.set(comment.id, { ...comment, children: [] });
    });

    flatComments.forEach((comment) => {
      const node = commentMap.get(comment.id)!;

      if (comment.parent_id && commentMap.has(comment.parent_id)) {
        commentMap.get(comment.parent_id)!.children.push(node);
      } else {
        rootComments.push(node);
      }
    });

    return rootComments;
  }

  /**
   * 点赞评论
   */
  async likeComment(commentId: string): Promise<{ likes: number; alreadyLiked?: boolean }> {
    const pb = this.getPocketBase();
    return pb.send(`/api/comments/${commentId}/like`, { method: 'POST' });
  }

  /**
   * 举报评论
   */
  async reportComment(commentId: string, reason: string): Promise<void> {
    const pb = this.getPocketBase();
    return pb.collection('comment_reports').create({
      comment_id: commentId,
      reason,
      status: 'pending',
    });
  }

  /**
   * 发送编辑/删除验证码
   */
  async sendVerificationCode(email: string): Promise<{ ok: boolean; expiresAt: string }> {
    const pb = this.getPocketBase();
    return pb.send('/api/comments/verification/send', {
      method: 'POST',
      body: { email },
    });
  }

  /**
   * 编辑评论
   */
  async editComment(commentId: string, content: string, authorEmail: string, verificationCode: string): Promise<void> {
    const pb = this.getPocketBase();
    return pb.send(`/api/comments/${commentId}/edit`, {
      method: 'POST',
      body: { content, author_email: authorEmail, verification_code: verificationCode },
    });
  }

  /**
   * 删除评论（软删除）
   */
  async deleteComment(commentId: string, authorEmail: string, verificationCode: string): Promise<void> {
    const pb = this.getPocketBase();
    return pb.send(`/api/comments/${commentId}/delete`, {
      method: 'POST',
      body: { author_email: authorEmail, verification_code: verificationCode },
    });
  }

  /**
   * 从错误中提取用户友好的消息
   */
  extractSubmitMessage(err: unknown): string {
    const anyErr = err as {
      message?: unknown;
      response?: { message?: unknown; data?: { message?: unknown } };
      data?: { message?: unknown };
    } | null | undefined;
    const candidates = [
      anyErr?.response?.data?.message,
      anyErr?.response?.message,
      anyErr?.data?.message,
      anyErr?.message,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return '提交失败，请重试';
  }
}

export const commentService = new CommentService();
