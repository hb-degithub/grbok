import { getPocketBase } from '../pocketbase';

/**
 * 数据洞察服务
 *
 * 设计原则：**容错聚合**。看板由「统计接口 + 互动排行」两块独立数据组成，
 * 任何一块拿不到都只能降级，不能让整页空白。
 *
 * 2026-11 变更：互动排行不再由前端直连 posts / reactions / comments 三个集合聚合。
 * `reactions` 集合的读权限是「仅管理员」，匿名/前端直连 `pb.collection('reactions').getList()`
 * 返回 403 Only admins，旧实现让整个 `getTopPosts()` reject，配合 `Promise.all` 让
 * `stats` 永远为 null —— 页面只剩「统计数据暂不可用」。
 *
 * 现在：
 * - 互动排行改走公开聚合接口 `GET /api/post-engagement?limit=50`
 *   （服务端一次性返回 postId / title / views / reactions / comments / score）；
 * - 总览仍走 `GET /api/blog-stats`；
 * - 两者用 `Promise.allSettled` 分别收敛：任一侧失败，另一侧照常渲染；
 * - 互动接口失败时 `getTopPosts()` 返回空数组（不 throw），
 *   UI 用「互动数据暂不可用」提示，而不是整页空白。
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

/** 互动聚合里各子数据源的可用性，供 UI 精确提示降级范围 */
export interface EngagementAvailability {
  /** 互动接口是否可用（失败时没有标题/浏览量/互动数可展示） */
  posts: boolean;
  /** 反应计数是否可用（接口失败时为 false，计数按 0 计） */
  reactions: boolean;
  /** 评论计数是否可用（接口失败时为 false，计数按 0 计） */
  comments: boolean;
}

export interface EngagementAggregate {
  posts: PostEngagement[];
  availability: EngagementAvailability;
  /** 任一互动维度降级 */
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

/** 公开互动聚合接口（限流/字段由服务端控制） */
const POST_ENGAGEMENT_PATH = '/api/post-engagement';

/** 接口默认返回条数（也是单次请求上限，避免被当成翻页参数滥用） */
const POST_ENGAGEMENT_LIMIT = 50;

/** 互动分数权重（后端未给 score 时前端按同一口径兜底）：浏览量 * 1 + 反应数 * 3 + 评论数 * 5 */
const SCORE = { views: 1, reactions: 3, comments: 5 } as const;

/** range 白名单，防止把任意串拼进 /api/blog-stats */
const ALLOWED_RANGES = ['24h', '7d', '30d', '90d', '1y'];

interface PostEngagementFeedItem {
  postId?: unknown;
  title?: unknown;
  views?: unknown;
  reactions?: unknown;
  comments?: unknown;
  score?: unknown;
}

interface PostEngagementFeed {
  items?: unknown;
  generatedAt?: unknown;
}

function describeFailure(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : String(err);
}

function toCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 10;
  return Math.min(POST_ENGAGEMENT_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * 把 /api/post-engagement 的 items 映射为页面同款 PostEngagement。
 * 接口字段缺失/类型异常时按 0 收敛，绝不因为一条脏数据把整个排行榜打掉。
 */
export function mapPostEngagementFeed(raw: unknown): PostEngagement[] {
  if (!Array.isArray(raw)) return [];
  const posts: PostEngagement[] = [];
  for (const item of raw) {
    const record = (item ?? {}) as PostEngagementFeedItem;
    const postId = asText(record.postId);
    if (!postId) continue;
    const views = toCount(record.views);
    const reactions = toCount(record.reactions);
    const comments = toCount(record.comments);
    const rawScore = typeof record.score === 'number' ? record.score : Number(record.score);
    const score = Number.isFinite(rawScore)
      ? Math.max(0, Math.floor(rawScore))
      : views * SCORE.views + reactions * SCORE.reactions + comments * SCORE.comments;
    posts.push({
      postId,
      title: asText(record.title) || '（无标题）',
      views,
      reactions,
      comments,
      score,
    });
  }
  return posts;
}

class InsightsService {
  async getBlogStats(range: string = '7d'): Promise<BlogStatsResponse> {
    const pb = getPocketBase();

    // 验证 range 参数，防止注入
    const safeRange = ALLOWED_RANGES.includes(range) ? range : '7d';

    return pb.send<BlogStatsResponse>(`/api/blog-stats?range=${safeRange}`, {
      method: 'GET',
    });
  }

  /**
   * 热门文章互动排行（容错版）。
   *
   * 接口失败时返回空数组而不是 reject；
   * 需要区分「空数据」与「不可用」时用 `getTopPostsAggregate()`。
   */
  async getTopPosts(limit: number = 10): Promise<PostEngagement[]> {
    const aggregate = await this.getTopPostsAggregate(limit);
    return aggregate.posts;
  }

  /** 热门文章互动排行 + 数据源可用性（供看板提示降级） */
  async getTopPostsAggregate(limit: number = 10): Promise<EngagementAggregate> {
    const safeLimit = clampLimit(limit);
    const pb = getPocketBase();

    try {
      const data = await pb.send<PostEngagementFeed>(`${POST_ENGAGEMENT_PATH}?limit=${safeLimit}`, {
        method: 'GET',
      });
      const posts = mapPostEngagementFeed(data?.items)
        .sort((a, b) => b.score - a.score)
        .slice(0, safeLimit);
      return {
        posts,
        availability: { posts: true, reactions: true, comments: true },
        degraded: false,
      };
    } catch (err) {
      // 公开接口也会因后端未部署 / 网关错误而失败：降级为空数组，统计与页面其余部分照常。
      console.warn('[insights] 互动数据接口不可用，排行降级为空：', describeFailure(err));
      return {
        posts: [],
        availability: { posts: false, reactions: false, comments: false },
        degraded: true,
      };
    }
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

    const topPosts = topPostsResult.status === 'fulfilled' ? topPostsResult.value.posts : [];

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
      partial: !availability.stats || !availability.posts,
    };
  }
}

export const insightsService = new InsightsService();
