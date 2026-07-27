import { useState, useEffect, useCallback } from 'react';
import { commentService } from '../lib/services/commentService';
import type {
  PublicComment,
  NestedComment,
  CommentFormData,
  CommentRealtimeEvent,
} from '../types/pocketbase';

export function useComments(postId: string, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [comments, setComments] = useState<NestedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Server-provided submission error surfaced to the visitor. Reset to null
  // on every successful submit so stale copy can't linger across attempts.
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    if (!enabled) {
      setComments([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const result = await commentService.getPublicComments(postId);
      setComments(commentService.buildCommentTree(result));
      setError(null);
    } catch (err) {
      console.error('Failed to fetch comments:', err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [postId, enabled]);

  useEffect(() => {
    // Guard against fetch races when postId changes rapidly: an in-flight
    // request for a previous post must not overwrite state for the current
    // one. The `active` flag is scoped to this effect run; the cleanup flips
    // it false so late-resolving callbacks bail before touching state.
    let active = true;

    const load = async () => {
      if (!enabled) {
        if (active) {
          setComments([]);
          setLoading(false);
        }
        return;
      }
      try {
        if (active) setLoading(true);
        const result = await commentService.getPublicComments(postId);
        if (!active) return;
        setComments(commentService.buildCommentTree(result));
        setError(null);
      } catch (err) {
        console.error('Failed to fetch comments:', err);
        if (active) setError(err as Error);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
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
    let cancelled = false;

    const subscribe = async () => {
      try {
        const unsub = await commentService.subscribeToPublicComments(handleRealtimeEvent);
        if (cancelled) {
          unsub();
        } else {
          unsubscribe = unsub;
        }
      } catch (err) {
        console.error('Failed to subscribe to public comments:', err);
      }
    };

    subscribe();

    return () => {
      active = false;
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [postId, enabled]);

  const submitComment = useCallback(
    async (data: CommentFormData): Promise<boolean> => {
      if (isSubmitting) return false;
      try {
        if (!enabled) return false;
        setIsSubmitting(true);
        await commentService.submitComment(postId, data);

        setSubmitError(null);
        return true;
      } catch (err) {
        console.error('Failed to submit comment:', err);
        // Surface the server-provided message to the visitor. PocketBase JS
        // SDK wraps hook errors as ClientResponseError with the hook's thrown
        // message in err.response.message (and mirrored on err.message).
        // Backend copy is our own curated Chinese phrasing (e.g. "请先验证你的
        // 邮箱后再发表评论"), so we display it verbatim with a generic
        // fallback when no usable string is present.
        const message = commentService.extractSubmitMessage(err);
        setSubmitError(message);
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [postId, enabled, isSubmitting]
  );

  return {
    comments,
    loading,
    error,
    isSubmitting,
    submitError,
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
