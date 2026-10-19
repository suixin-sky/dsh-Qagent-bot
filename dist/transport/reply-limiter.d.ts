/**
 * 被动回复限额管理。
 *
 * QQ Bot 被动回复有限额：同一条消息只能被动回复 N 次，超时后不能再被动回复。
 * 当限额耗尽或消息过期时，应降级为主动消息（proactive，不传 msgId）。
 */
export interface ReplyLimiterConfig {
    /** 每条消息最大被动回复次数（默认 4，留 1 次余量） */
    limit?: number;
    /** 消息 ID 过期时间 ms（默认 1 小时） */
    ttlMs?: number;
    /** 最大跟踪消息数（LRU 驱逐，默认 10000） */
    maxTrackedMessages?: number;
}
export interface ReplyLimitResult {
    allowed: boolean;
    remaining: number;
    fallbackReason?: 'expired' | 'limit_exceeded';
}
export declare class ReplyLimiter {
    private readonly limit;
    private readonly ttlMs;
    private readonly maxTracked;
    private readonly messages;
    constructor(config?: ReplyLimiterConfig);
    /** 检查是否允许对指定消息继续被动回复 */
    checkLimit(messageId: string): ReplyLimitResult;
    /** 记录一次被动回复 */
    record(messageId: string): void;
}
//# sourceMappingURL=reply-limiter.d.ts.map