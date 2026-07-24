/**
 * Feature Flags 类型定义与默认值。
 *
 * 所有智能功能开关存储在 PocketBase settings 表，
 * key = "feature_flags"，value = FeatureFlags JSON。
 *
 * 前端通过 useSiteSettings hook 读取（已有），
 * 后台通过 FeatureFlagsPanel 组件管理（新增）。
 *
 * 资产保护：纯数据驱动，不修改任何前端 DOM/动画/CSS。
 * 前端组件根据 flag 值决定是否渲染（如 Chatbot Widget）。
 */

export interface FeatureFlags {
  /** RAG 助手 Chatbot Widget */
  rag_chatbot: {
    enabled: boolean;
    endpoint: string;
    faqs_json: string;
  };
  /** 隐私埋点 SDK */
  privacy_analytics: {
    enabled: boolean;
    sample_rate: number; // 0-1，事件采样率
  };
  /** Newsletter 订阅 */
  newsletter: {
    enabled: boolean;
    frequency: 'weekly' | 'biweekly' | 'monthly';
  };
  /** A/B 测试 */
  ab_testing: {
    enabled: boolean;
    active_experiments: string[];
  };
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  rag_chatbot: {
    enabled: false,
    endpoint: '/api/chat',
    faqs_json: '[]',
  },
  privacy_analytics: {
    enabled: false,
    sample_rate: 1,
  },
  newsletter: {
    enabled: false,
    frequency: 'weekly',
  },
  ab_testing: {
    enabled: false,
    active_experiments: [],
  },
};

export const FEATURE_FLAGS_KEY = 'feature_flags';

/**
 * 安全暴露字段标注：
 * - settings 表 listRule 白名单已包含 feature_flags（迁移 20260724090000）
 * - feature_flags 中的值会被前端读取（useSiteSettings）
 * - 仅 enabled / endpoint / frequency 等非敏感配置暴露
 * - 不包含任何密钥、令牌或内部路径
 */
