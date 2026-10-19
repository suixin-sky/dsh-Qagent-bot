/**
 * ModelResolver — 统一的模型发现与路由解析
 *
 * 职责：
 *   1. 解析当前生效的默认模型路由
 *   2. 列出可用 providers 和模型
 *   3. 管理 per-peer 的模型偏好（委托 PrefsStore）
 *
 * 优先级（从高到低）：
 *   per-peer 偏好（~/.dsh-qqbot/model-prefs.json）
 *   > config 显式指定（cordis.yml 的 provider/model）
 *   > settings.yaml 的 agent-default-model（只读，作为默认兜底）
 *   > 宿主 agentDefaultModel 服务
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { ModelRoute, ModelEntry } from './types.ts';
export declare class ModelResolver {
    private readonly prefs;
    private readonly settings;
    private readonly ctx;
    private readonly config;
    private readonly logger?;
    constructor(ctx: Context, config: ImQQBotConfig, logger?: Logger);
    /**
     * 获取指定 sessionKey 的有效模型路由（create 用）
     *
     * 优先级：per-peer 偏好 > config 显式指定 > settings.yaml > 宿主服务
     */
    getEffectiveRoute(sessionKey: string): ModelRoute | undefined;
    /**
     * 获取 resume 时覆盖 session 的模型路由
     *
     * 优先级：per-peer 偏好 > cordis.yml 显式配置 > 默认链（settings.yaml > host）
     *
     * 这里不返回 undefined，因为未装 installModelSelection，system-prompt 的
     * {{model}} 变量直接读 agent.options.model——若无值会抛
     * "prompt variable {{model}} has no value for this assembly"。
     * 因此兜底到默认链，确保 agent.options.model 始终有值。
     */
    getResumeRoute(sessionKey: string): ModelRoute | undefined;
    /**
     * 设置 per-peer 模型偏好并持久化到隔离文件
     */
    setOverride(sessionKey: string, route: ModelRoute): void;
    /**
     * 清除 per-peer 模型偏好并持久化
     */
    clearOverride(sessionKey: string): void;
    /**
     * 是否存在指定 session 的模型偏好
     */
    hasOverride(sessionKey: string): boolean;
    /**
     * 获取指定 sessionKey 的最新 sessionId（fork 后记录，重启恢复用）
     */
    getSessionId(sessionKey: string): string | undefined;
    /**
     * 记录指定 sessionKey 的最新 sessionId（fork 后调用）并持久化
     */
    setSessionId(sessionKey: string, sessionId: string): void;
    /**
     * 清除指定 sessionKey 的 sessionId 记录
     */
    clearSessionId(sessionKey: string): void;
    /**
     * 获取指定 sessionKey 的 per-peer preset 覆盖
     */
    getPreset(sessionKey: string): string | undefined;
    /**
     * 设置 per-peer preset 覆盖并持久化
     */
    setPreset(sessionKey: string, presetId: string): void;
    /**
     * 清除 per-peer preset 覆盖并持久化
     */
    clearPreset(sessionKey: string): boolean;
    /**
     * 解析默认模型路由（不含 per-peer 偏好）
     *
     * 优先级：config 显式指定 > settings.yaml（只读） > 宿主 agentDefaultModel
     * 最终兜底 deepseek-official/deepseek-v4-flash，确保 {{model}} 变量始终有值。
     */
    resolveDefault(): ModelRoute;
    /**
     * 列出所有可用模型
     *
     * 优先走 ctx.llm 服务动态发现，服务不可用或失败时回退 settings.yaml 静态配置。
     */
    listModels(): Promise<ModelEntry[]>;
    /**
     * 列出可用 provider 名称
     */
    listProviders(): string[];
    private readFromHost;
    /** 统一的 Cordis 服务访问（可选获取：服务未注入时静默返回 undefined，避免 Proxy 抛错） */
    private getService;
    /** 获取 ctx.llm 服务（最小接口收窄，不可用时返回 undefined） */
    private getLlmService;
}
//# sourceMappingURL=model-resolver.d.ts.map