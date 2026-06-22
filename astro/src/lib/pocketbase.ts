import PocketBase from 'pocketbase';

/**
 * PocketBase 工厂函数
 * 解决 SSR 环境下模块级单例的状态污染问题
 */

const POCKETBASE_URL = import.meta.env.PUBLIC_POCKETBASE_URL || 'http://localhost:8090';

/**
 * 创建新的 PocketBase 实例
 * SSR 环境下每次请求创建新实例，避免状态污染
 */
export function createPocketBase(): PocketBase {
  return new PocketBase(POCKETBASE_URL);
}

/**
 * 获取客户端 PocketBase 单例
 * 仅在浏览器环境下使用单例，SSR 环境每次创建新实例
 */
let clientInstance: PocketBase | null = null;

export function getPocketBase(): PocketBase {
  // SSR 环境：每次创建新实例
  if (typeof window === 'undefined') {
    return createPocketBase();
  }

  // 客户端：使用单例
  if (!clientInstance) {
    clientInstance = createPocketBase();
    // 禁用自动取消（Realtime 订阅需要）
    clientInstance.autoCancellation(false);
  }

  return clientInstance;
}

/**
 * @deprecated 使用 getPocketBase() 或 createPocketBase() 替代
 * 保留用于向后兼容
 */
export const pb = typeof window !== 'undefined'
  ? getPocketBase()
  : createPocketBase();

// 导出类型
export type { RecordModel, ListResult } from 'pocketbase';
