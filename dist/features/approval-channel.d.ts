/**
 * ApprovalChannel — 把 dsh 的审批 seam（`approval/request` waterfall）桥接到 QQ。
 *
 * 接入方式：监听 `approval/request` waterfall，按 `request.agent.id` 路由到 QQ
 * 会话；非 QQ 会话委托链上其他 answerer（`next()`），多通道（Web/TUI）共存。
 *
 * 每个会话同一时间最多一个 pending 审批（审批是阻塞式的）；outcome 是 dsh
 * 协议的闭合集合，无 allow-always，只提供「允许一次 / 拒绝」两个按钮。
 */
import type { InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
/** session log 中 tool/call 事件的最小结构（commandOf 回显命令用） */
interface ApprovalSessionEvent {
    type: string;
    data?: {
        callId?: unknown;
        arguments?: unknown;
        [key: string]: unknown;
    };
}
export interface ApprovalRequest {
    agent: {
        id: string;
        session: {
            events: ApprovalSessionEvent[];
        };
    };
    toolName: string;
    /** 关联的 tool/call 事件 id，用于从 session log 找回被 gate 的命令 */
    callId?: string;
    /** asker 的人类可读解释 */
    reason?: string;
    signal?: AbortSignal;
}
export interface ApprovalSessionRecordLike {
    sessionKey: string;
    scope: ChatScope;
    replyTarget: ReplyTarget;
}
export interface ApprovalChannelManagerLike {
    findBySessionId(sessionId: string): ApprovalSessionRecordLike | undefined;
    getSessionRecord(scope: ChatScope, peerId: string): ApprovalSessionRecordLike | undefined;
}
export interface ApprovalChannelSenderLike {
    sendMarkdown(target: ReplyTarget, content: string, opts?: {
        keyboard?: unknown;
    }): Promise<unknown>;
}
/** approval/request waterfall 的 answerer handler */
export interface ApprovalChannelContext {
    get(name: string): unknown;
    on(event: string, handler: (...args: unknown[]) => unknown, options?: {
        prepend?: boolean;
    }): void;
}
export declare class ApprovalChannel {
    private readonly pending;
    private readonly manager;
    private readonly sender;
    private readonly logger;
    constructor(manager: ApprovalChannelManagerLike, sender: ApprovalChannelSenderLike, logger: Logger);
    /**
     * 注册 approval/request waterfall answerer。approval 服务未挂载时优雅禁用。
     */
    install(ctx: ApprovalChannelContext): void;
    /** 会话回收时清理其 pending 审批，避免 Promise 悬挂 */
    cancelPending(sessionKey: string): void;
    /** 按钮点击决策：解码 button_data，settle pending 审批 */
    handleInteraction(event: InteractionEvent): boolean;
    /** 走 QQ 通道：发审批消息 + 挂起 Promise，等待用户决策 */
    private park;
    private removeAbort;
}
export {};
//# sourceMappingURL=approval-channel.d.ts.map