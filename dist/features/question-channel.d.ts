/**
 * QuestionChannel — 把 dsh 的 ask_user_question 桥接到 QQ 通道。
 *
 * 接入方式：包装 `userQuestions.ask`（而非 registerProvider），按 `request.agent.id`
 * 路由到 QQ 会话；非 QQ 会话委托宿主默认 provider（如 Web 弹出框），多通道共存。
 *
 * 每会话一个显式状态机，三态语义：
 *   - 待答（pending 中）：等待当前题的回答
 *   - 逐题推进：多问题时一次问一题，答完一题再问下一题
 *   - 完成 / 中断（abort / 超时 / 会话回收）：reject(ASK_ABORTED)
 */
import type { InlineKeyboard, InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
export interface UserQuestionOption {
    label: string;
    description?: string;
}
export interface UserQuestion {
    id: string;
    header?: string;
    question: string;
    options?: UserQuestionOption[];
    multiSelect?: boolean;
}
export interface UserQuestionAnswer {
    id: string;
    selected: string[];
    custom?: string;
}
export interface UserQuestionRequest {
    questions: UserQuestion[];
    agent?: {
        id?: string;
    };
    signal?: AbortSignal;
}
export interface UserQuestionResult {
    answers: UserQuestionAnswer[];
}
export interface UserQuestionsServiceLike {
    ask: (request: UserQuestionRequest) => Promise<UserQuestionResult>;
    __qqQuestionPatched?: boolean;
}
export interface QuestionSessionRecordLike {
    sessionKey: string;
    scope: ChatScope;
    replyTarget: ReplyTarget;
}
export interface QuestionChannelManagerLike {
    findBySessionId(sessionId: string): QuestionSessionRecordLike | undefined;
    getSessionRecord(scope: ChatScope, peerId: string): QuestionSessionRecordLike | undefined;
}
export interface QuestionChannelSenderLike {
    sendMarkdown(target: ReplyTarget, content: string, opts?: {
        keyboard?: InlineKeyboard;
    }): Promise<unknown>;
}
export interface QuestionChannelConfigLike {
    requireMention: boolean;
    askTimeoutMs: number;
}
export declare class QuestionChannel {
    private readonly pending;
    private uq?;
    private origAsk?;
    private readonly manager;
    private readonly sender;
    private readonly config;
    private readonly logger;
    constructor(manager: QuestionChannelManagerLike, sender: QuestionChannelSenderLike, config: QuestionChannelConfigLike, logger: Logger);
    /**
     * 包装 userQuestions.ask：QQ 会话走 QQ 通道，其余委托原实现。
     * 幂等（已 patch 则跳过）；服务缺失或 ask 非函数时优雅禁用。
     */
    install(ctx: {
        get(name: string): unknown;
    }): void;
    uninstall(): void;
    /** 会话回收时清理其待答问题，避免 pending 悬挂导致 Promise 与闭包泄漏 */
    cancelPending(sessionKey: string): void;
    /** 入站文本作答：该会话若有待答问题且本条消息有文本，解析为答案并推进 */
    tryAnswer(scope: ChatScope, peerId: string, text: string): boolean;
    /** 按钮点击作答：解码 button_data 选项下标，推进状态机 */
    handleInteraction(event: InteractionEvent): boolean;
    /** 走 QQ 通道：发送首题 + 挂起 Promise，等待逐题作答 */
    private askViaQQ;
    /** 推进状态机：收集答案 → 有下一题则发送，否则 resolve 全部答案 */
    private advance;
    /** 发送单个问题：优先带按钮，按钮发送失败降级纯文本 */
    private sendQuestion;
    private onTimeout;
    private resetTimer;
    private clearTimer;
    private removeAbort;
}
//# sourceMappingURL=question-channel.d.ts.map