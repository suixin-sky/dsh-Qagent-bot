/**
 * 归档路径计算 —— 独立模块，避免 chat-archive 与 members 互相 import 成环。
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
/** 默认归档根目录（可用 archive.dir 覆盖） */
export const DEFAULT_ARCHIVE_ROOT = join(homedir(), '.dsh-qqbot', 'chatlog');
/** 归档根目录：配置优先，空则默认 */
export function archiveRoot(config) {
    const dir = String(config?.archive?.dir ?? '').trim();
    return dir ? resolve(dir) : DEFAULT_ARCHIVE_ROOT;
}
/** 会话目录名：scope + 净化后的 peerId（openid 只含字母数字，基本原样） */
export function peerSlug(scope, peerId) {
    const safe = String(peerId ?? '').replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 48) || 'unknown';
    return `${scope === 'group' ? 'group' : 'c2c'}-${safe}`;
}
