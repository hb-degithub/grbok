import { getPocketBase } from '../pocketbase';
import type { RecordModel, ListResult, SendOptions } from 'pocketbase';

/**
 * 基础服务类
 * 封装 PocketBase 通用 CRUD 操作，提供类型安全的数据访问层
 */
export class BaseService<T extends RecordModel> {
  protected collection: string;

  constructor(collection: string) {
    this.collection = collection;
  }

  /**
   * 获取列表数据
   */
  async getList(page = 1, perPage = 50, options?: Record<string, unknown>): Promise<ListResult<T>> {
    const pb = getPocketBase();
    return pb.collection(this.collection).getList<T>(page, perPage, options);
  }

  /**
   * 获取完整列表（不分页）
   */
  async getFullList(options?: Record<string, unknown>): Promise<T[]> {
    const pb = getPocketBase();
    return pb.collection(this.collection).getFullList<T>(options);
  }

  /**
   * 获取单条记录
   */
  async getOne(id: string, options?: Record<string, unknown>): Promise<T> {
    const pb = getPocketBase();
    return pb.collection(this.collection).getOne<T>(id, options);
  }

  /**
   * 获取第一条匹配记录
   */
  async getFirstListItem(filter: string, options?: Record<string, unknown>): Promise<T> {
    const pb = getPocketBase();
    return pb.collection(this.collection).getFirstListItem<T>(filter, options);
  }

  /**
   * 创建记录
   */
  async create(data: Partial<T>): Promise<T> {
    const pb = getPocketBase();
    return pb.collection(this.collection).create<T>(data);
  }

  /**
   * 更新记录
   */
  async update(id: string, data: Partial<T>): Promise<T> {
    const pb = getPocketBase();
    return pb.collection(this.collection).update<T>(id, data);
  }

  /**
   * 删除记录
   */
  async delete(id: string): Promise<boolean> {
    const pb = getPocketBase();
    return pb.collection(this.collection).delete(id);
  }

  /**
   * 发送自定义请求
   */
  async send<R>(path: string, options: SendOptions = {}): Promise<R> {
    const pb = getPocketBase();
    return pb.send<R>(path, options);
  }

  /**
   * 获取 PocketBase 实例
   */
  getPocketBase() {
    return getPocketBase();
  }

  /**
   * 构建过滤器
   */
  filter(filter: string, params?: Record<string, unknown>): string {
    const pb = getPocketBase();
    return pb.filter(filter, params);
  }
}
