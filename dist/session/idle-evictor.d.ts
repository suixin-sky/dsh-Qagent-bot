/**
 * IdleEvictor — 闲置会话回收器
 *
 * 定期检查会话最后活跃时间，超时则自动回收释放资源。
 */
import type { SessionRecord } from './types.ts';
export declare class IdleEvictor {
    private timer;
    private readonly sessions;
    private readonly timeoutMs;
    private readonly onEvict;
    constructor(sessions: Map<string, SessionRecord>, timeoutMs: number, onEvict: (key: string, record: SessionRecord) => void);
    /** 执行一轮回收检查 */
    check(): void;
    /** 停止回收定时器 */
    dispose(): void;
}
//# sourceMappingURL=idle-evictor.d.ts.map