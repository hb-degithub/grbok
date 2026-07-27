import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';
import type { PublicComment, NestedComment, CommentFormData, CommentRealtimeEvent } from '../../types/pocketbase';

const PUBLIC_COMMENT_FIELDS = 'id,post_id,author_name,content,parent_id,status,created,updated';

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
   * 获取文章的公开评论列表
   */
  async getPublicComments(postId: string): Promise<PublicComment[]> {
    const pb = this.getPocketBase();
    return pb.collection('public_comments').getFullList<PublicComment>({
      filter: pb.filter('post_id = {:postId}', { postId }),
      sort: 'created',
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
