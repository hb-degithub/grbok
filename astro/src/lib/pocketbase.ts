import PocketBase from 'pocketbase';

// PocketBase 客户端单例
export const pb = new PocketBase(import.meta.env.PUBLIC_POCKETBASE_URL || 'http://localhost:8090');

// 禁用自动取消（SSR 需要）
pb.autoCancellation(false);

// 导出类型
export type { RecordModel, ListResult } from 'pocketbase';
