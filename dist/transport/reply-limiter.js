/**
 * 被动回复限额管理。
 *
 * QQ Bot 被动回复有限额：同一条消息只能被动回复 N 次，超时后不能再被动回复。
 * 当限额耗尽或消息过期时，应降级为主动消息（proactive，不传 msgId）。
 */
export class ReplyLimiter {
    limit;
    ttlMs;
    maxTracked;
    messages = new Map();
    constructor(config) {
        this.limit = config?.limit ?? 4;
        this.ttlMs = config?.ttlMs ?? 3600_000;
        this.maxTracked = config?.maxTrackedMessages ?? 10_000;
    }
    /** 检查是否允许对指定消息继续被动回复 */
    checkLimit(messageId) {
        const now = Date.now();
        const tracked = this.messages.get(messageId);
        if (!tracked) {
            return { allowed: true, remaining: this.limit };
        }
        if (now - tracked.firstSeenAt > this.ttlMs) {
            this.messages.delete(messageId);
            return { allowed: false, remaining: 0, fallbackReason: 'expired' };
        }
        const remaining = Math.max(0, this.limit - tracked.count);
        if (remaining <= 0) {
            return { allowed: false, remaining: 0, fallbackReason: 'limit_exceeded' };
        }
        return { allowed: true, remaining };
    }
    /** 记录一次被动回复 */
    record(messageId) {
        const now = Date.now();
        const tracked = this.messages.get(messageId);
        if (tracked) {
            tracked.count += 1;
            return;
        }
        if (this.messages.size >= this.maxTracked) {
            const firstKey = this.messages.keys().next().value;
            if (firstKey !== undefined)
                this.messages.delete(firstKey);
        }
        this.messages.set(messageId, { count: 1, firstSeenAt: now });
    }
}
//# sourceMappingURL=reply-limiter.js.map