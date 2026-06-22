import { useState, useEffect, useCallback } from 'react';
import { getPocketBase } from '../lib/pocketbase';
import type {
  Comment,
  NestedComment,
  CommentFormData,
  CommentRealtimeEvent,
} from '../types/pocketbase';

/**
 * 评论 Hook
 * 提供评论的 CRUD 操作、Realtime 订阅和嵌套树构建
 */
export function useComments(postId: string) {
  const [comments, setComments] = useState<NestedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * 将扁平评论列表转换为嵌套树结构
   * @param flatComments - 从 PocketBase 获取的扁平评论列表
   * @returns 嵌套的评论树
   */
  const buildCommentTree = useCallback((flatComments: Comment[]): NestedComment[] => {
    const commentMap = new Map<string, NestedComment>();
    const rootComments: NestedComment[] = [];

    // 第一遍：创建所有节点的映射
    flatComments.forEach((comment) => {
      commentMap.set(comment.id, { ...comment, children: [] });
    });

    // 第二遍：构建树结构
    flatComments.forEach((comment) => {
      const node = commentMap.get(comment.id)!;

      if (comment.parent_id && commentMap.has(comment.parent_id)) {
        // 有父评论，添加到父评论的 children
        const parent = commentMap.get(comment.parent_id)!;
        parent.children.push(node);
      } else {
        // 无父评论或父评论不存在，作为根评论
        rootComments.push(node);
      }
    });

    return rootComments;
  }, []);

  /**
   * 获取评论列表
   */
  const fetchComments = useCallback(async () => {
    try {
      setLoading(true);
      const pb = getPocketBase();
      const result = await pb.collection('comments').getFullList<Comment>({
        filter: `post_id = "${postId}" && status = "approved"`,
        sort: 'created',
      });

      const tree = buildCommentTree(result);
      setComments(tree);
    } catch (err) {
      console.error('获取评论失败:', err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [postId, buildCommentTree]);

  /**
   * Realtime 订阅处理
   * 监听 comments 集合的 CREATE/UPDATE/DELETE 事件
   */
  useEffect(() => {
    // 初始获取评论
    fetchComments();

    /**
     * Realtime 事件回调
     * 根据事件类型更新评论树
     */
    const handleRealtimeEvent = (event: CommentRealtimeEvent) => {
      const { action, record } = event;

      // 只处理当前文章的评论
      if (record.post_id !== postId) return;
      // 只处理已审核的评论
      if (record.status !== 'approved') return;

      setComments((prevComments) => {
        switch (action) {
          case 'create': {
            // 新评论插入
            const newComment: NestedComment = { ...record, children: [] };

            if (record.parent_id) {
              // 有父评论，添加到对应父评论的 children
              return addToParent(prevComments, record.parent_id, newComment);
            } else {
              // 无父评论，添加到根列表顶部
              return [newComment, ...prevComments];
            }
          }

          case 'update': {
            // 更新评论内容
            return updateInTree(prevComments, record);
          }

          case 'delete': {
            // 删除评论
            return removeFromTree(prevComments, record.id);
          }

          default:
            return prevComments;
        }
      });
    };

    /**
     * 订阅 PocketBase Realtime
     * 使用 pb.collection().subscribe() 方法
     */
    let unsubscribe: (() => void) | null = null;

    const subscribe = async () => {
      try {
        const pb = getPocketBase();
        unsubscribe = await pb
          .collection('comments')
          .subscribe('*', (e) => {
            handleRealtimeEvent({
              action: e.action as 'create' | 'update' | 'delete',
              record: e.record as Comment,
            });
          });
      } catch (err) {
        console.error('Realtime 订阅失败:', err);
      }
    };

    subscribe();

    // 清理订阅
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [postId, fetchComments]);

  /**
   * 提交新评论
   */
  const submitComment = useCallback(
    async (data: CommentFormData): Promise<boolean> => {
      try {
        const pb = getPocketBase();
        await pb.collection('comments').create({
          post_id: postId,
          author_name: data.author_name,
          author_email: data.author_email,
          content: data.content,
          parent_id: data.parent_id || null,
          status: 'approved', // 本地测试直接通过
        });

        return true;
      } catch (err) {
        console.error('提交评论失败:', err);
        return false;
      }
    },
    [postId]
  );

  return {
    comments,
    loading,
    error,
    submitComment,
    refresh: fetchComments,
  };
}

/**
 * 辅助函数：将新评论添加到父评论的 children
 */
function addToParent(
  comments: NestedComment[],
  parentId: string,
  newComment: NestedComment
): NestedComment[] {
  return comments.map((comment) => {
    if (comment.id === parentId) {
      return {
        ...comment,
        children: [...comment.children, newComment],
      };
    }
    if (comment.children.length > 0) {
      return {
        ...comment,
        children: addToParent(comment.children, parentId, newComment),
      };
    }
    return comment;
  });
}

/**
 * 辅助函数：更新树中的评论
 */
function updateInTree(comments: NestedComment[], updated: Comment): NestedComment[] {
  return comments.map((comment) => {
    if (comment.id === updated.id) {
      return { ...comment, ...updated, children: comment.children };
    }
    if (comment.children.length > 0) {
      return {
        ...comment,
        children: updateInTree(comment.children, updated),
      };
    }
    return comment;
  });
}

/**
 * 辅助函数：从树中删除评论
 */
function removeFromTree(comments: NestedComment[], commentId: string): NestedComment[] {
  return comments
    .filter((comment) => comment.id !== commentId)
    .map((comment) => ({
      ...comment,
      children: removeFromTree(comment.children, commentId),
    }));
}
