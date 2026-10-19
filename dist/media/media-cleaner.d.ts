import type { Context } from '@deepseek-ai/cordis';
import type { Logger } from '../types.ts';
/** 富媒体下载根目录（attachment.ts 复用） */
export declare const MEDIA_ROOT: string;
/**
 * 清理过期的富媒体文件（按文件 mtime 判断，异步并发执行，不阻塞事件循环）
 *
 * @param ttlHours 保留时长（小时），<=0 表示永不过期（跳过清理）
 * @returns 删除的文件数
 */
export declare function cleanupExpiredMedia(ttlHours: number, logger?: Logger): Promise<number>;
/**
 * 启动富媒体过期清理：启动时清理一次 + 定期清理（每 1 小时）
 *
 * 用 ctx.effect 挂载定时器，插件卸载时自动 clearInterval。
 * ttlHours <= 0 时不启动（永不过期）。
 */
export declare function startMediaCleanup(ctx: Context, ttlHours: number, logger: Logger): void;
//# sourceMappingURL=media-cleaner.d.ts.map