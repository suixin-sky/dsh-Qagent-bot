/**
 * 被动回复目标缓存 — 记录最近处理的 msgId / eventId，供「无上下文的出站发送」
 * 获取被动回复目标。
 *
 * 按类型区分：普通消息 msgId（填 msg_id）与互动事件 eventId（填 event_id），
 * 避免用字符串前缀做隐式类型判别。
 */
import type { ChatScope } from '../types.ts';
/** 被动回复目标类型 */
export type ReplyIdKind = 'msg' | 'event';
/** 缓存的被动回复目标 */
export interface CachedReplyId {
    kind: ReplyIdKind;
    /** msg: 消息 id；event: 带 INTERACTION_CREATE 前缀的完整事件 id */
    id: string;
}
/** 记录普通消息 msgId */
export declare function cacheMsgId(scope: ChatScope, targetId: string | undefined, msgId: string | undefined): void;
/** 记录互动事件 eventId（内部拼 INTERACTION_CREATE 前缀） */
export declare function cacheEventId(scope: ChatScope, targetId: string | undefined, eventId: string | undefined): void;
/** 获取所有未过期的被动回复目标（按时间倒序，最新在前） */
export declare function getCachedReplyIds(scope: ChatScope, targetId: string): CachedReplyId[];
//# sourceMappingURL=msgid-cache.d.ts.map