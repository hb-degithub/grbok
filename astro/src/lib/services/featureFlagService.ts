import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAGS_KEY,
  type FeatureFlags,
} from '../../config/feature-flags';

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  created: string;
  updated: string;
}

/**
 * 功能开关服务 —— 存储为 PocketBase `settings` 表中的一行：
 * key = "feature_flags"，value = FeatureFlags JSON（settings.value 是 json 字段）。
 *
 * 背景（2026-11-20 生产缺陷）：旧实现把开关当成独立集合 `feature_flags` 读写，
 * 但 PB 里从来没有这个集合（迁移 20260724090000 只把 feature_flags 加进 settings
 * 的公开读白名单），/admin/features 每次请求都 404，页面不可用。
 *
 * 设计约束：
 * - 不新增集合、不改迁移：开关只占用 settings 里已存在的公开键 feature_flags；
 * - 前台读取路径（lib/site-settings.ts / useSiteSettings）不变，仍读到同一个 JSON 对象；
 * - 后台面板接口（getFlags / getFlag / setFlag / createFlag / updateFlag）保持不变，
 *   返回 { id, key, name, description, enabled, created, updated } 形状。
 *
 * 三个约定：
 * 1. `id` 就是条目 key：settings 只有一行，条目本身没有数据库 id；
 *    面板的 key / 删除 / 编辑都按 key 定位，用 key 当 id 可保持既有调用方可用。
 * 2. `name` / `description` 是展示层派生值（已知键用 FLAG_LABELS，未知键回落为 key），
 *    不写入 settings —— feature_flags 的 JSON 形状必须保持 config/feature-flags.ts
 *    定义的「enabled + 领域字段」，前台 useSiteSettings 按同一形状合并读取。
 * 3. 写 enabled 时只合并目标条目的 enabled，其余条目与条目内其他字段原样保留；
 *    只有「settings 里没有该记录」的首次保存才以 DEFAULT_FEATURE_FLAGS 为基线，
 *    避免把其他开关从库里冲掉。
 */

/** settings 表中 feature_flags 行（value 是 JSON 字段，SDK 通常已解析为对象）。 */
interface FeatureFlagsSetting extends RecordModel {
  key: string;
  value: unknown;
}

/** 单个开关在 feature_flags JSON 里的条目：至少 { enabled }，其余字段按开关类型而定。 */
type FlagEntry = Record<string, unknown>;
type StoredFlags = Record<string, FlagEntry>;

/**
 * 已知开关的展示文案（沿用旧版 FeatureFlagsPanel 的产品文案）。
 * FeatureFlags 类型本身不含展示字段，后台列表的名称/描述由这里派生；
 * 未知 key 没有文案，name 回落为 key、description 缺省。
 */
const FLAG_LABELS: Record<string, { name: string; description?: string }> = {
  rag_chatbot: {
    name: 'RAG 助手',
    description: '悬浮 Chatbot Widget，API 失败时降级为静态 FAQ',
  },
  privacy_analytics: {
    name: '隐私埋点',
    description: '无 Cookie 隐私埋点，尊重 DNT，sendBeacon 上报',
  },
  newsletter: {
    name: 'Newsletter',
    description: '订阅表单与邮件频率控制',
  },
  ab_testing: {
    name: 'A/B 测试',
    description: '客户端特征标志，实验变体动态渲染',
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 深拷贝默认值：DEFAULT_FEATURE_FLAGS 是模块级常量，绝不能被写入路径原地修改。 */
function cloneDefaultFlags(): StoredFlags {
  return JSON.parse(JSON.stringify(DEFAULT_FEATURE_FLAGS)) as StoredFlags;
}

/**
 * 解析 settings.value。与 site-settings.ts 的读取口径保持一致：
 * PB 的 json 字段正常回传对象，历史/手写数据可能是 JSON 字符串，解析失败视为空配置。
 */
function parseFlagsValue(value: unknown): StoredFlags {
  if (isPlainObject(value)) return value as StoredFlags;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value || '{}');
      return isPlainObject(parsed) ? (parsed as StoredFlags) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * 把条目归一化为对象。历史数据里可能出现 true/false 这类标量条目，
 * 读取时等价于 { enabled: 标量 }，写回时也会被归一化为对象（无法保留不存在的字段）。
 */
function normalizeEntry(entry: unknown): FlagEntry {
  if (isPlainObject(entry)) return entry;
  return typeof entry === 'boolean' ? { enabled: entry } : {};
}

/** 已知键的默认条目（深拷贝），用于条目尚未落库时补齐 endpoint/sample_rate 等领域字段。 */
function defaultEntry(key: string): FlagEntry {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_FEATURE_FLAGS, key)) return {};
  const entry = cloneDefaultFlags()[key];
  return isPlainObject(entry) ? entry : {};
}

class FeatureFlagService extends BaseService<FeatureFlagsSetting> {
  constructor() {
    super('settings');
  }

  /** 列出全部开关：Config 里的已知开关（未落库时用默认值）+ 库里多出来的未知键。 */
  async getFlags(): Promise<FeatureFlag[]> {
    const { record, stored } = await this.loadFlags();
    return Object.entries(this.withDefaults(stored)).map(([key, entry]) =>
      this.toFlag(key, entry, record)
    );
  }

  /** 按 key 读取单个开关；key 既不在 Config 也不在库里时返回 null。 */
  async getFlag(key: string): Promise<FeatureFlag | null> {
    const { record, stored } = await this.loadFlags();
    const merged = this.withDefaults(stored);
    if (!Object.prototype.hasOwnProperty.call(merged, key)) return null;
    return this.toFlag(key, merged[key], record);
  }

  /** 只改目标条目的 enabled，保留该条目的 endpoint / sample_rate / frequency 等字段。 */
  async setFlag(key: string, enabled: boolean): Promise<void> {
    await this.writeEntry(key, { enabled: enabled === true });
  }

  /**
   * 新建开关（面板“新建/保存”实际走这里）。语义为 upsert：
   * 已存在的 key 只更新 enabled，保留其余字段，避免面板重复创建同一开关。
   */
  async createFlag(data: Omit<FeatureFlag, 'id' | 'created' | 'updated'>): Promise<FeatureFlag> {
    const key = typeof data.key === 'string' ? data.key.trim() : '';
    if (!key) throw new Error('功能开关标识不能为空');
    return this.writeEntry(key, { enabled: data.enabled === true });
  }

  /**
   * 更新开关。settings 条目里只有 enabled 属于开关值，
   * name/description 是展示层派生值，写进 JSON 会污染前台读取的形状，因此只接受 enabled。
   */
  async updateFlag(id: string, data: Partial<FeatureFlag>): Promise<FeatureFlag> {
    if (typeof data.enabled !== 'boolean') {
      // 没有可写字段时不制造空条目：回读当前值，不存在则明确报错
      const current = await this.getFlag(id);
      if (!current) throw new Error(`功能开关不存在：${id}`);
      return current;
    }
    return this.writeEntry(id, { enabled: data.enabled });
  }

  /**
   * 删除开关条目。settings 一行承载全部开关，所以这里是「从对象里移除该 key」而不是删记录。
   * 已知开关被删除后会回落为 config 默认值（读取时合并），未知键则彻底消失。
   */
  async deleteFlag(id: string): Promise<void> {
    const { record, stored } = await this.loadFlags();
    if (!record || !Object.prototype.hasOwnProperty.call(stored, id)) return;
    const next: StoredFlags = { ...stored };
    delete next[id];
    await this.saveFlags(record, next);
  }

  async isEnabled(key: string): Promise<boolean> {
    const flag = await this.getFlag(key);
    return flag?.enabled ?? false;
  }

  /**
   * 读取 feature_flags 行。
   * 只有「记录不存在」（404）才回落空配置，其余错误（权限/网络/服务端）一律向上抛，
   * 避免把真实故障伪装成“还没有配置过”。
   */
  private async loadFlags(): Promise<{ record: FeatureFlagsSetting | null; stored: StoredFlags }> {
    const pb = this.getPocketBase();
    try {
      const record = await this.getFirstListItem(
        pb.filter('key = {:key}', { key: FEATURE_FLAGS_KEY })
      );
      return { record, stored: parseFlagsValue(record.value) };
    } catch (error) {
      if ((error as { status?: number } | null)?.status === 404) {
        return { record: null, stored: {} };
      }
      throw error;
    }
  }

  /** 已知开关始终出现（未落库时展示 config 默认值），未知键如实追加在后面。 */
  private withDefaults(stored: StoredFlags): StoredFlags {
    return { ...cloneDefaultFlags(), ...stored };
  }

  private toFlag(key: string, entry: unknown, record: FeatureFlagsSetting | null): FeatureFlag {
    const normalized = normalizeEntry(entry);
    const label = FLAG_LABELS[key];
    return {
      id: key,
      key,
      name: label?.name ?? key,
      description: label?.description,
      enabled: normalized.enabled === true,
      // settings 只有一行，所有开关共享该行的时间戳
      created: record?.created ?? '',
      updated: record?.updated ?? '',
    };
  }

  /**
   * 合并写回单个条目：
   * - settings 无记录（首次保存）→ 基线是 DEFAULT_FEATURE_FLAGS 的深拷贝；
   * - 有记录 → 基线就是库里已存的对象，其他开关原样保留；
   * - 目标条目缺失且属于已知开关 → 先用该开关的默认字段补种（endpoint/sample_rate 等），
   *   避免只写 { enabled } 导致前台合并后读不到领域字段。
   */
  private async writeEntry(key: string, patch: FlagEntry): Promise<FeatureFlag> {
    const { record, stored } = await this.loadFlags();
    const base = record ? stored : cloneDefaultFlags();
    const seed = base[key] === undefined ? defaultEntry(key) : {};
    const nextEntry: FlagEntry = { ...seed, ...normalizeEntry(base[key]), ...patch };
    const nextValue: StoredFlags = { ...base, [key]: nextEntry };
    const saved = await this.saveFlags(record, nextValue);
    return this.toFlag(key, nextEntry, saved);
  }

  private async saveFlags(
    record: FeatureFlagsSetting | null,
    value: StoredFlags
  ): Promise<FeatureFlagsSetting> {
    if (record) return this.update(record.id, { value });
    return this.create({ key: FEATURE_FLAGS_KEY, value });
  }
}

export const featureFlagService = new FeatureFlagService();
