import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';
import { withAuthRequestHeaders } from '../security';
import { describePbError, isStepUpRequired } from '../pb-error';

/** AI 审核结论：approve / spam / unsure / error */
export type GuestbookVerdict = 'approve' | 'spam' | 'unsure' | 'error' | string;

/** 审核结论 → 中文标签（后台徽章与批量汇总共用） */
export const GUESTBOOK_VERDICT_LABELS: Record<string, string> = {
  approve: '通过',
  spam: '垃圾',
  unsure: '存疑',
  error: '失败',
};

export function guestbookVerdictLabel(verdict?: string): string {
  if (!verdict) return '未审核';
  return GUESTBOOK_VERDICT_LABELS[verdict] || verdict;
}

/**
 * 留言项接口
 */
export interface GuestbookItem extends RecordModel {
  nickname: string;
  content: string;
  /** 'show' = 对外展示；'hidden'（历史）/ 'hide'（AI spam 后后端写入）都视为已隐藏 */
  status: string;
  /** AI 审核结论（空 = 未审核） */
  ai_verdict?: string;
  /** AI 审核理由 */
  ai_reason?: string;
  /** AI 是否已审核过 */
  ai_moderated?: boolean;
}

/** POST /api/blog-admin/ai/guestbook/moderate 的响应 */
export interface GuestbookModerateResult {
  verdict: GuestbookVerdict;
  reason: string;
  status: string;
}

const MODERATE_PATH = '/api/blog-admin/ai/guestbook/moderate';

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 留言板服务
 * 封装留言板相关的所有数据操作
 */
class GuestbookService extends BaseService<GuestbookItem> {
  constructor() {
    super('guestbook_messages');
  }

  /**
   * 获取留言列表
   * @param statusFilter 状态筛选：''（全部）、'show'（显示中）、'hidden'（已隐藏，兼容后端 'hide'）
   */
  async getItems(statusFilter: string = ''): Promise<GuestbookItem[]> {
    // AI 判定为 spam 后后端写 status='hide'，历史数据是 'hidden'；两者都要归入「已隐藏」。
    // 用 != "show" 而不是枚举两个值，避免再出现第三种隐藏态时筛选漏数据。
    const filter = statusFilter === 'show'
      ? 'status = "show"'
      : statusFilter === 'hidden'
        ? 'status != "show"'
        : undefined;
    const result = await this.getList(1, 50, {
      sort: '-created',
      filter,
    });
    return result.items;
  }

  /**
   * 切换显示状态
   */
  async toggleStatus(item: GuestbookItem): Promise<GuestbookItem> {
    const next = item.status === 'show' ? 'hidden' : 'show';
    return this.update(item.id, { status: next });
  }

  /**
   * 触发单条留言的 AI 审核（super_admin + step-up 门槛由服务端把关）。
   * 结论会写回 guestbook_messages 的 ai_verdict / ai_reason / ai_moderated；
   * spam 时服务端同时把 status 置为隐藏（'hide'）。
   */
  async moderate(id: string): Promise<GuestbookModerateResult> {
    const pb = this.getPocketBase();
    try {
      const data = await withAuthRequestHeaders(pb, () =>
        pb.send<Partial<GuestbookModerateResult>>(MODERATE_PATH, {
          method: 'POST',
          body: { message_id: id },
        }),
      );
      return {
        verdict: asText(data?.verdict) || 'error',
        reason: asText(data?.reason),
        status: asText(data?.status),
      };
    } catch (err) {
      // step-up 过期保留原始错误，交由 hook 广播重验事件（翻译后的 Error 会丢失 403 语义）
      if (isStepUpRequired(err)) throw err;
      throw new Error(describePbError(err, 'AI 审核失败'), { cause: err });
    }
  }
}

export const guestbookService = new GuestbookService();
