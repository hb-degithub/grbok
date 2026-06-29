import { useState, useEffect, useCallback } from 'react';
import { getPocketBase } from '../lib/pocketbase';
import type {
  PublicComment,
  NestedComment,
  CommentFormData,
  CommentRealtimeEvent,
} from '../types/pocketbase';

const PUBLIC_COMMENT_FIELDS = 'id,post_id,author_name,content,parent_id,status,created,updated';

export function useComments(postId: string, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [comments, setComments] = useState<NestedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const buildCommentTree = useCallback((flatComments: PublicComment[]): NestedComment[] => {
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
  }, []);

  const fetchComments = useCallback(async () => {
    if (!enabled) {
      setComments([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const pb = getPocketBase();
      const result = await pb.collection('public_comments').getFullList<PublicComment>({
        filter: pb.filter('post_id = {:postId}', { postId }),
        sort: 'created',
        fields: PUBLIC_COMMENT_FIELDS,
      });

      setComments(buildCommentTree(result));
      setError(null);
    } catch (err) {
      console.error('Failed to fetch comments:', err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [postId, buildCommentTree, enabled]);

  useEffect(() => {
    fetchComments();
    if (!enabled) return;

    const handleRealtimeEvent = (event: CommentRealtimeEvent) => {
      const { action, record } = event;
      if (record.post_id !== postId) return;
      if (record.status !== 'approved') return;

      setComments((prevComments) => {
        switch (action) {
          case 'create': {
            const newComment: NestedComment = { ...record, children: [] };
            return record.parent_id ? addToParent(prevComments, record.parent_id, newComment) : [newComment, ...prevComments];
          }
          case 'update':
            return updateInTree(prevComments, record);
          case 'delete':
            return removeFromTree(prevComments, record.id);
          default:
            return prevComments;
        }
      });
    };

    let unsubscribe: (() => void) | null = null;

    const subscribe = async () => {
      try {
        const pb = getPocketBase();
        unsubscribe = await pb.collection('public_comments').subscribe('*', (e) => {
          handleRealtimeEvent({
            action: e.action as 'create' | 'update' | 'delete',
            record: e.record as PublicComment,
          });
        });
      } catch (err) {
        console.error('Failed to subscribe to public comments:', err);
      }
    };

    subscribe();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [postId, fetchComments, enabled]);

  const submitComment = useCallback(
    async (data: CommentFormData): Promise<boolean> => {
      try {
        if (!enabled) return false;
        const pb = getPocketBase();
        await pb.collection('comments').create({
          post_id: postId,
          author_name: data.author_name,
          author_email: data.author_email,
          content: data.content,
          parent_id: data.parent_id || null,
        });

        return true;
      } catch (err) {
        console.error('Failed to submit comment:', err);
        return false;
      }
    },
    [postId, enabled]
  );

  return {
    comments,
    loading,
    error,
    submitComment,
    refresh: fetchComments,
  };
}

function addToParent(
  comments: NestedComment[],
  parentId: string,
  newComment: NestedComment
): NestedComment[] {
  return comments.map((comment) => {
    if (comment.id === parentId) {
      return { ...comment, children: [...comment.children, newComment] };
    }
    if (comment.children.length > 0) {
      return { ...comment, children: addToParent(comment.children, parentId, newComment) };
    }
    return comment;
  });
}

function updateInTree(comments: NestedComment[], updated: PublicComment): NestedComment[] {
  return comments.map((comment) => {
    if (comment.id === updated.id) {
      return { ...comment, ...updated, children: comment.children };
    }
    if (comment.children.length > 0) {
      return { ...comment, children: updateInTree(comment.children, updated) };
    }
    return comment;
  });
}

function removeFromTree(comments: NestedComment[], commentId: string): NestedComment[] {
  return comments
    .filter((comment) => comment.id !== commentId)
    .map((comment) => ({ ...comment, children: removeFromTree(comment.children, commentId) }));
}