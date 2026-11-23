import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

/**
 * 数据洞察服务
 *
 * 设计原则：**容错聚合**。看板由「统计接口 + 互动聚合」两块独立数据组成，
 * 任何一块拿不到都只能降级，不能让整页空白。
 *
 * 背景（2026-11 生产实测）：`reactions` 集合的读权限是「仅管理员」，
 * 匿名/前端直连 `pb.collection('reactions').getList()` 返回 403 Only admins。
 * 旧实现把 posts / reactions / comments 三次请求直接串在一起 await，
 * 一次 403 就让整个 `getTopPosts()` reject，配合 useInsights 的 `Promise.all`
 * 让 `stats` 永远为 null —— 页面只剩「统计数据暂不可用」。
 *
 * 现在：posts / reactions / comments 用 `Promise.allSettled` 分别收敛，
 * reactions / comments 失败时计数按 0 计，并在快照里标记不可用，
 * 由 UI 给一句不打断阅读的「部分互动数据不可用」。
 */

export interface PageStat {
  path: string;
  views: number;
}

export interface BlogStatsResponse {
  range: string;
  totalViews: number;
  todayViews: number;
  uniqueVisitors: number;
  daily: { date: string; views: number }[];
  topPages: PageStat[];
  topReferrers: { referrer: string; views: number }[];
  detail?: {
    uaCategories: { category: string; views: number }[];
  };
  geo?: {
    countries: { country: string; views: number; uniqueVisitors: number }[];
    regions: { country: string; region: string; city: string; views: number; uniqueVisitors: number }[];
  };
}

export interface PostEngagement {
  postId: string;
  title: string;
  views: number;
  reactions: number;
  comments: number;
  score: number;
}

export interface Reaction {
  id: string;
  post_id: string;
  type: string;
  created: string;
}

/** 互动聚合里各子数据源的可用性，供 UI 精确提示降级范围 */
export interface EngagementAvailability {
  /** posts 主查询是否成功（失败时没有标题/浏览量可展示） */
  posts: boolean;
  /** reactions 是否可读（403 Only admins 时为 false，计数按 0 计） */
  reactions: boolean;
  /** comments 是否可读（失败时计数按 0 计） */
  comments: boolean;
}

export interface EngagementAggregate {
  posts: PostEngagement[];
  availability: EngagementAvailability;
  /** 任一互动维度降级（posts 之外的降级不影响浏览量排序） */
  degraded: boolean;
}

/** 看板一次取数的完整快照：任一部分失败都不影响其余部分渲染 */
export interface InsightsSnapshot {
  stats: BlogStatsResponse | null;
  topPosts: PostEngagement[];
  availability: EngagementAvailability & { stats: boolean };
  /** 至少一个数据源降级 —— UI 展示轻量提示 */
  partial: boolean;
}

type ReactionRecord = Reaction & RecordModel;

/** 互动分数的权重：浏览量 * 1 + 反应数 * 3 + 评论数 * 5 */
const SCORE = { views: 1, reactions: 3, comments: 5 } as const;

/** PocketBase ID 格式（15 位小写字母数字），用于过滤注入防护 */
const ID_RE = /^[a-z0-9]{15}$/;

/** range 白名单，防止把任意串拼进 /api/blog-stats */
const ALLOWED_RANGES = ['24h', '7d', '30d', '90d', '1y'];

function describeFailure(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : String(err);
}

class InsightsService extends BaseService<ReactionRecord> {
  constructor() {
    super('reactions');
  }

  async getBlogStats(range: string = '7d'): Promise<BlogStatsResponse> {
    const pb = this.getPocketBase();

    // 验证 range 参数，防止注入
    const safeRange = ALLOWED_RANGES.includes(range) ? range : '7d';

    return pb.send<BlogStatsResponse>(`/api/blog-stats?range=${safeRange}`, {
      method: 'GET',
    });
  }

  /**
   * 按文章 ID 聚合互动数据（容错版）。
   *
   * - posts 查询失败：没有标题/浏览量可用，返回空列表 + availability.posts=false；
   * - reactions / comments 查询失败：对应计数保持 0，其余数据照常返回。
   *
   * 任何单点失败都不会 throw，调用方永远拿得到一个可用结构。
   */
  async getEngagementAggregate(postIds: string[]): Promise<EngagementAggregate> {
    const pb = this.getPocketBase();

    const safeIds = postIds.filter((id) => ID_RE.test(id));

    if (safeIds.length === 0) {
      return {
        posts: [],
        availability: { posts: true, reactions: true, comments: true },
        degraded: false,
      };
    }

    // 构建参数化 filter
    const buildIdFilter = (field: string) =>
      safeIds
        .map((id, i) => {
          const key = `id${i}`;
          return pb.filter(`${field} = {:${key}}`, { [key]: id });
        })
        .join(' || ');

    const [postsResult, reactionsResult, commentsResult] = await Promise.allSettled([
      pb.collection('posts').getList(1, 100, {
        filter: buildIdFilter('id'),
        fields: 'id,title,views',
      }),
      pb.collection('reactions').getList(1, 500, {
        filter: buildIdFilter('post_id'),
      }),
      pb.collection('comments').getList(1, 500, {
        filter: buildIdFilter('post_id') + ' && status = "approved"',
      }),
    ]);

    const availability: EngagementAvailability = {
      posts: postsResult.status === 'fulfilled',
      reactions: reactionsResult.status === 'fulfilled',
      comments: commentsResult.status === 'fulfilled',
    };

    if (postsResult.status === 'rejected') {
      console.warn('[insights] posts 查询失败，互动排行降级为空：', describeFailure(postsResult.reason));
    }
    if (reactionsResult.status === 'rejected') {
      // 生产上这就是 403 Only admins：匿名不可读 reactions。降级为 0，不打断整个看板。
      console.warn('[insights] reactions 不可读，反应计数按 0 计：', describeFailure(reactionsResult.reason));
    }
    if (commentsResult.status === 'rejected') {
      console.warn('[insights] comments 查询失败，评论计数按 0 计：', describeFailure(commentsResult.reason));
    }

    const engagementMap = new Map<string, PostEngagement>();

    if (postsResult.status === 'fulfilled') {
      postsResult.value.items.forEach((post) => {
        engagementMap.set(post.id, {
          postId: post.id,
          title: post.title,
          views: Number(post.views) || 0,
          reactions: 0,
          comments: 0,
          score: 0,
        });
      });
    }

    if (reactionsResult.status === 'fulfilled') {
      reactionsResult.value.items.forEach((reaction) => {
        const engagement = engagementMap.get(reaction.post_id);
        if (engagement) engagement.reactions++;
      });
    }

    if (commentsResult.status === 'fulfilled') {
      commentsResult.value.items.forEach((comment) => {
        const engagement = engagementMap.get(comment.post_id);
        if (engagement) engagement.comments++;
      });
    }

    engagementMap.forEach((engagement) => {
      engagement.score =
        engagement.views * SCORE.views +
        engagement.reactions * SCORE.reactions +
        engagement.comments * SCORE.comments;
    });

    return {
      posts: Array.from(engagementMap.values()).sort((a, b) => b.score - a.score),
      availability,
      degraded: !availability.reactions || !availability.comments,
    };
  }

  /** 兼容旧调用：只要互动列表，reactions 不可读时 score 退化为「仅浏览量」 */
  async getPostEngagement(postIds: string[]): Promise<PostEngagement[]> {
    const aggregate = await this.getEngagementAggregate(postIds);
    return aggregate.posts;
  }

  /**
   * 热门文章互动排行（容错版）。
   *
   * reactions 403 时：仍返回按 views 排序的结果（score 只用 views），
   * 而不是整块失败。
   */
  async getTopPosts(limit: number = 10): Promise<PostEngagement[]> {
    const aggregate = await this.getTopPostsAggregate(limit);
    return aggregate.posts;
  }

  /** 热门文章互动排行 + 各数据源可用性（供看板提示降级） */
  async getTopPostsAggregate(limit: number = 10): Promise<EngagementAggregate> {
    const pb = this.getPocketBase();

    let postIds: string[] = [];
    let postsAvailable = true;
    try {
      // 获取所有已发布文章
      const postsResult = await pb.collection('posts').getList(1, 200, {
        filter: 'status = "published"',
        fields: 'id',
      });
      postIds = postsResult.items.map((p) => p.id);
    } catch (err) {
      // 连文章列表都拿不到：排行降级为空，但底层统计照常展示
      postsAvailable = false;
      console.warn('[insights] 已发布文章列表查询失败，互动排行降级为空：', describeFailure(err));
    }

    const aggregate = await this.getEngagementAggregate(postIds);
    return {
      posts: aggregate.posts.slice(0, limit),
      availability: {
        ...aggregate.availability,
        posts: postsAvailable && aggregate.availability.posts,
      },
      degraded: !postsAvailable || aggregate.degraded,
    };
  }

  /**
   * 看板一次性取数：统计接口与互动排行彼此独立。
   *
   * `Promise.allSettled` 保证任一侧失败时另一侧仍能渲染；
   * 失败信息只做 console.warn，不向页面抛错。
   */
  async getInsightsSnapshot(range: string = '7d', limit: number = 10): Promise<InsightsSnapshot> {
    const [statsResult, topPostsResult] = await Promise.allSettled([
      this.getBlogStats(range),
      this.getTopPostsAggregate(limit),
    ]);

    const statsAvailable = statsResult.status === 'fulfilled';
    if (!statsAvailable) {
      console.warn('[insights] 统计数据接口不可用：', describeFailure(statsResult.reason));
    }

    const topPosts =
      topPostsResult.status === 'fulfilled'
        ? topPostsResult.value.posts
        : [];

    const availability: InsightsSnapshot['availability'] = {
      stats: statsAvailable,
      posts: topPostsResult.status === 'fulfilled' ? topPostsResult.value.availability.posts : false,
      reactions: topPostsResult.status === 'fulfilled' ? topPostsResult.value.availability.reactions : false,
      comments: topPostsResult.status === 'fulfilled' ? topPostsResult.value.availability.comments : false,
    };

    return {
      stats: statsAvailable ? statsResult.value : null,
      topPosts,
      availability,
      partial: !availability.stats || !availability.reactions || !availability.comments || !availability.posts,
    };
  }
}

export const insightsService = new InsightsService();
