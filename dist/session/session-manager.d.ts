import type { Context } from '@deepseek-ai/cordis';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { ModelRoute, ModelEntry } from '../model/types.ts';
import type { QuestionChannel } from '../features/question-channel.ts';
import type { ApprovalChannel } from '../features/approval-channel.ts';
import type { DshAgent, DshAgentRegistry, PresetEntry, PresetSwitchOutcome, SessionRecord, SessionStatus, TokenUsageStats, CompactOutcome } from './types.ts';
export declare class SessionManager {
    private sessions;
    private readonly evictor;
    private readonly modelResolver;
    private readonly ctx;
    private readonly agents;
    private readonly config;
    private readonly logger;
    /** 由 bootstrap 注入的问答通道（ask_user_question → QQ），会话回收时清理其待答问题 */
    questionChannel?: QuestionChannel;
    /** 由 bootstrap 注入的审批通道（approval/request → QQ），会话回收时清理其待批审批 */
    approvalChannel?: ApprovalChannel;
    constructor(ctx: Context, agents: DshAgentRegistry, config: ImQQBotConfig, logger: Logger);
    /**
     * 通过 system-prompt/assemble waterfall 注入群聊/私聊额外 system prompt。
     *
     * 该事件在每次 turn 构建 request 时触发；此处按会话 scope（群聊/私聊）
     * 追加对应的额外 prompt section。会话尚未建立（首次 assemble）或未配置
     * 额外 prompt 时原样返回，不做改动。
     */
    private registerScopePromptInjection;
    /**
     * 动态获取 sessions 服务（fork 能力，可选）
     */
    private getSessionsService;
    /**
     * 动态获取 agentPresets 服务（可选，未注入时返回 undefined）
     */
    private getPresetsService;
    /**
     * 从 session 持久化 header 读 session 当初的 preset（started 锁定语义）。
     * 读不到（服务缺失 / session 不存在 / 未记录 agentPreset）返回 undefined。
     */
    private resolvePersistedPreset;
    getEffectiveModel(scope: ChatScope, peerId: string): ModelRoute | undefined;
    /**
     * 获取指定 peer 的生效 preset（per-peer 覆盖 > config.preset）
     */
    getEffectivePreset(scope: ChatScope, peerId: string): string | undefined;
    /** 按 sessionKey 解析生效 preset */
    private getEffectivePresetByKey;
    /**
     * 列出所有可用 preset（/preset 命令用）
     */
    listPresets(): Promise<PresetEntry[]>;
    /**
     * 切换模型（fork + 重建会话，保留历史）
     */
    setModelOverride(scope: ChatScope, peerId: string, route: ModelRoute): Promise<void>;
    /**
     * 切换指定 peer 的 agent preset（per-peer 覆盖）
     *
     * 已开始的会话保持锁定（blank-session contract）：只持久化为新会话默认，
     * 不 fork/rebuild 当前会话，避免历史工具调用与新 preset 工具集冲突。
     */
    setPresetOverride(scope: ChatScope, peerId: string, presetId: string): Promise<PresetSwitchOutcome>;
    /**
     * 清除 per-peer preset 覆盖，回到 config.preset / 默认（新会话生效）
     */
    clearPresetOverride(scope: ChatScope, peerId: string): Promise<PresetSwitchOutcome>;
    /**
     * fork + 重建会话（保留历史，换 model）
     *
     * options.route 缺省时沿用当前生效值。preset 沿用当前生效 preset（getEffectivePresetByKey）。
     * fork 不可用或失败时降级为 dispose（下次消息重建）。
     */
    private rebuildSession;
    clearModelOverride(scope: ChatScope, peerId: string): void;
    listAvailableModels(): Promise<ModelEntry[]>;
    listProviders(): string[];
    getSessionRecord(scope: ChatScope, peerId: string): SessionRecord | undefined;
    getStatus(scope: ChatScope, peerId: string): SessionStatus;
    getTokenUsage(scope: ChatScope, peerId: string): TokenUsageStats;
    exportMarkdown(scope: ChatScope, peerId: string): string;
    private countMessages;
    private sessionKey;
    private deriveSessionId;
    private currentSessionId;
    private composePreset;
    /** 获取或恢复或创建会话（get → resume → create） */
    getOrCreate(scope: ChatScope, peerId: string, senderId: string, replyTarget: ReplyTarget): Promise<SessionRecord>;
    findBySessionId(sessionId: string): SessionRecord | undefined;
    findByAgent(agent: DshAgent): SessionRecord | undefined;
    remove(scope: ChatScope, peerId: string): Promise<void>;
    /**
     * 原地压缩当前会话历史（保留 sessionId，用摘要替换旧历史）。
     *
     * 需通过 agentPresets.serviceFor(agent, 'compaction') 解析；未挂载时优雅降级。
     * 这是「压缩上下文」的语义，区别于 remove() 的「换新会话」。
     */
    compact(scope: ChatScope, peerId: string): Promise<CompactOutcome>;
    disposeAll(): Promise<void>;
    get size(): number;
}
//# sourceMappingURL=session-manager.d.ts.map