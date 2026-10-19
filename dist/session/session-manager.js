/**
 * SessionManager — 管理 QQ peer → dsh Agent 的映射和生命周期
 *
 * sessionKey 格式: `qqbot:${appId}:${kind}:${peerId}`
 *   - c2c:   peerId = senderId (用户 openid)
 *   - group: peerId = groupOpenid
 *
 * SessionId 由 sessionKey 确定性派生（SHA-256），
 * 保证同一个用户/群的消息始终路由到同一个会话，
 * 重启后可根据 key 恢复 session。
 *
 * 支持 agent-presets 系统：通过 setup hook 在 create/resume 时
 * 挂载 preset（工具集、prompt sections 等），实现场景化配置。
 */
import { createHash, randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { ModelResolver } from "../model/model-resolver.js";
import { IdleEvictor } from "./idle-evictor.js";
import { archiveRoot } from "../features/chat-archive.js";
import { personaForRoute } from "../features/persona.js";
import { stickerCategories } from "../features/stickers.js";
/** ManualCompactionError 各 code 的友好提示 */
const COMPACTION_ERROR_HINTS = {
    busy: '压缩服务忙，请稍后重试',
    cancelled: '压缩已取消',
    changed: '历史在压缩过程中发生变化，请重试',
    commit: '压缩提交失败',
    persistence: '压缩完成但保存失败',
};
export class SessionManager {
    sessions = new Map();
    /** 千金大小姐：会话级回流截止时间（仅内存；进程重启即失效） */
    summonDeadlines = new Map();
    evictor;
    modelResolver;
    ctx;
    agents;
    config;
    logger;
    /** 由 bootstrap 注入的问答通道（ask_user_question → QQ），会话回收时清理其待答问题 */
    questionChannel;
    /** 由 bootstrap 注入的审批通道（approval/request → QQ），会话回收时清理其待批审批 */
    approvalChannel;
    constructor(ctx, agents, config, logger) {
        this.ctx = ctx;
        this.agents = agents;
        this.config = config;
        this.logger = logger;
        this.modelResolver = new ModelResolver(ctx, config, logger);
        this.evictor = new IdleEvictor(this.sessions, config.sessionIdleTimeout, (key, record) => {
            this.logger.info(`evicting idle session: key=${key}`);
            this.sessions.delete(key);
            this.summonDeadlines.delete(key);
            record.agent.cancel({ kind: 'user' });
            void record.handle.dispose().catch(() => { });
            // 回收会话时统一清理其待答问题/待批审批，避免 pending 悬挂泄漏
            this.questionChannel?.cancelPending(key);
            this.approvalChannel?.cancelPending(key);
        });
        this.registerScopePromptInjection();
        this.clearStaleSummonOverrides();
    }
    /**
     * 通过 system-prompt/assemble waterfall 注入群聊/私聊额外 system prompt。
     *
     * 该事件在每次 turn 构建 request 时触发；此处按会话 scope（群聊/私聊）
     * 追加对应的额外 prompt section。会话尚未建立（首次 assemble）或未配置
     * 额外 prompt 时原样返回，不做改动。
     */
    registerScopePromptInjection() {
        const assemble = async (_assembly, context, next) => {
            const assembled = await next();
            if (!context.agent)
                return assembled;
            const record = this.findByAgent(context.agent);
            if (!record)
                return assembled;
            const sections = [...(assembled.sections ?? [])];
            // 人设按「当前会话实际使用的模型」选择：默认模型和本地模型各用各的
            const route = this.getEffectiveModel(record.scope, record.peerId);
            const persona = personaForRoute(this.config, route, this.logger);
            if (persona)
                sections.push({ name: 'qqbot:persona', order: 1, text: persona.text });
            // 安全边界：只允许碰工作区和 DSH 数据目录
            sections.push({
                name: 'qqbot:security',
                order: 2,
                text: '只允许访问 D:\\QQat 与 DSH 数据目录内的文件；不要读取系统目录、其他用户目录、凭据/配置文件。'
                    + '工具报「路径不在允许范围内」时不要换路径重试，直接告诉用户。',
            });
            const prompt = record.scope === 'group' ? this.config.groupPrompt : this.config.directPrompt;
            if (prompt)
                sections.push({ name: 'qqbot:scope-prompt', order: 90, text: prompt });
            // 归档提示：告诉模型「历史/成员在这个文件里、用工具查」，不塞正文，几乎不占 token
            if (this.config.archive?.enabled !== false && this.config.archive?.promptHint !== false) {
                const root = archiveRoot(this.config);
                sections.push({
                    name: 'qqbot:archive-hint',
                    order: 91,
                    text: `本会话聊天记录归档在 ${root}（每个会话一个目录：chat.md + images/），成员名录在 ${root} 下的 members.md。`
                        + '消息行里的 [名称|短ID] 中短ID 是 openid 前 8 位，换昵称后据此对应同一个人。\n'
                        + '用户让你回看之前的消息或图片时调用 qqbot_chat_log；确认谁是谁调用 qqbot_members。\n'
                        + '只有在用户明确点名要某张图时才调用 qqbot_send_archived_image（index=1 表示最近一张），不要主动发图。',
                });
            }
            // 表情包提示：只在图库非空时注入。分类语义放在工具描述里，这里只提醒用法
            if (this.config.sticker?.enabled !== false && this.config.sticker?.promptHint !== false) {
                const tags = stickerCategories(this.config).map((t) => `${t.tag}(${t.count})`).join('、');
                if (tags) {
                    sections.push({
                        name: 'qqbot:sticker-hint',
                        order: 92,
                        text: `想用表情包表达情绪时调用 qqbot_send_sticker（可用标签：${tags}）。`
                            + '像群友那样偶尔发，别连着刷屏；没有贴切的不发。',
                    });
                }
            }
            // ComfyUI 图片/视频生成提示
            if (this.config.comfyui?.enabled !== false && this.config.comfyui?.workflow) {
                sections.push({
                    name: 'qqbot:comfy-hint',
                    order: 93,
                    text: '用户要图（画一张、立绘、三视图、头像、插画）→ qqbot_generate_image；'
                        + '要视频/动画/动起来 → qqbot_generate_video。先看用户要什么再选工具，别两个都调。'
                        + '有参考图就传 reference_image（走图生图）；视频提示词按 MiniMax 格式写，单段不超过 10 秒；'
                        + '画质默认 0.5、最高 1。工具会自动把成品发到群里并 @ 发起人，不要再用 qqbot_send_file 重发。',
                });
            }
            if (sections.length === (assembled.sections ?? []).length)
                return assembled;
            return {
                ...assembled,
                sections,
            };
        };
        this.ctx.on('system-prompt/assemble', assemble);
    }
    /**
     * 动态获取 sessions 服务（fork 能力，可选）
     */
    getSessionsService() {
        try {
            return this.ctx.get('sessions');
        }
        catch {
            return undefined;
        }
    }
    /**
     * 动态获取 agentPresets 服务（可选，未注入时返回 undefined）
     */
    getPresetsService() {
        try {
            return this.ctx.get('agentPresets');
        }
        catch {
            return undefined;
        }
    }
    /**
     * 从 session 持久化 header 读 session 当初的 preset（started 锁定语义）。
     * 读不到（服务缺失 / session 不存在 / 未记录 agentPreset）返回 undefined。
     */
    async resolvePersistedPreset(sessionId) {
        let persistence;
        try {
            persistence = this.ctx.get('sessionPersistence');
        }
        catch {
            return undefined;
        }
        if (!persistence)
            return undefined;
        try {
            const { meta } = await persistence.load(sessionId);
            return meta?.agentPreset;
        }
        catch {
            return undefined;
        }
    }
    // ── 模型相关（委托给 ModelResolver） ──
    getEffectiveModel(scope, peerId) {
        return this.modelResolver.getEffectiveRoute(this.sessionKey(scope, peerId));
    }
    /**
     * 获取指定 peer 的生效 preset（per-peer 覆盖 > config.preset）
     */
    getEffectivePreset(scope, peerId) {
        return this.getEffectivePresetByKey(this.sessionKey(scope, peerId));
    }
    /** 按 sessionKey 解析生效 preset */
    getEffectivePresetByKey(key) {
        return this.modelResolver.getPreset(key) ?? this.config.preset;
    }
    /**
     * 列出所有可用 preset（/preset 命令用）
     */
    async listPresets() {
        const presets = this.getPresetsService();
        if (!presets)
            return [];
        try {
            const list = await presets.list();
            return list.map((p) => ({ id: p.id, name: p.name, description: p.description }));
        }
        catch (err) {
            this.logger.warn(`list presets failed: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    /**
     * 切换模型（fork + 重建会话，保留历史）
     */
    async setModelOverride(scope, peerId, route) {
        const key = this.sessionKey(scope, peerId);
        // 任何显式换模型都退出召唤模式（enterSummon 会在调用后重新计时）
        this.summonDeadlines.delete(key);
        this.modelResolver.setOverride(key, route);
        const record = this.sessions.get(key);
        if (!record) {
            this.logger.info(`model pref saved (no active session): key=${key} → ${route.provider}/${route.model}`);
            return;
        }
        await this.rebuildSession(record, { route });
        this.logger.info(`model switched via fork: key=${key} → ${route.provider}/${route.model}`);
    }
    /**
     * 切换指定 peer 的 agent preset（per-peer 覆盖）
     *
     * 已开始的会话保持锁定（blank-session contract）：只持久化为新会话默认，
     * 不 fork/rebuild 当前会话，避免历史工具调用与新 preset 工具集冲突。
     */
    async setPresetOverride(scope, peerId, presetId) {
        const key = this.sessionKey(scope, peerId);
        // 1. 校验 preset 存在 + 可加载（broken 拒绝）
        const presets = this.getPresetsService();
        if (!presets)
            return { ok: false, reason: 'unavailable' };
        let resolved;
        try {
            resolved = await presets.resolve(presetId);
        }
        catch (err) {
            return { ok: false, reason: 'unknown-preset', message: err instanceof Error ? err.message : String(err) };
        }
        if (resolved.broken !== undefined) {
            return { ok: false, reason: 'broken', message: resolved.broken };
        }
        // 2. 持久化 per-peer 覆盖（新会话生效）
        this.modelResolver.setPreset(key, presetId);
        const hasActive = this.sessions.has(key);
        this.logger.info(`preset pref saved: key=${key} → ${presetId}${hasActive ? ' (active session locked, next session applies)' : ''}`);
        return { ok: true, presetId };
    }
    /**
     * 清除 per-peer preset 覆盖，回到 config.preset / 默认（新会话生效）
     */
    async clearPresetOverride(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        this.modelResolver.clearPreset(key);
        this.logger.info(`preset pref cleared: key=${key} (next session applies)`);
        return { ok: true };
    }
    /**
     * fork + 重建会话（保留历史，换 model）
     *
     * options.route 缺省时沿用当前生效值。preset 沿用当前生效 preset（getEffectivePresetByKey）。
     * fork 不可用或失败时降级为 dispose（下次消息重建）。
     */
    async rebuildSession(record, options) {
        const key = record.sessionKey;
        const sessionsService = this.getSessionsService();
        if (!sessionsService) {
            this.logger.warn(`fork unavailable, fallback to dispose: key=${key}`);
            this.sessions.delete(key);
            record.agent.cancel({ kind: 'user' });
            await record.handle.dispose().catch(() => { });
            return;
        }
        let seed;
        try {
            seed = sessionsService.fork(record.agent.session).events;
        }
        catch (err) {
            this.logger.warn(`fork failed, fallback to dispose: key=${key} err=${err instanceof Error ? err.message : String(err)}`);
            this.sessions.delete(key);
            record.agent.cancel({ kind: 'user' });
            await record.handle.dispose().catch(() => { });
            return;
        }
        const childId = SessionId(randomUUID());
        const effectiveRoute = options.route ?? this.modelResolver.getEffectiveRoute(key);
        const composed = await this.composePreset(this.getEffectivePresetByKey(key));
        const created = await this.agents.create({
            sessionId: childId,
            seed,
            meta: {
                cwd: this.config.cwd || process.cwd(),
                parentSession: record.sessionId,
                seedLength: seed.length,
                ...(composed.agentPreset ? { agentPreset: composed.agentPreset } : {}),
            },
            ...(effectiveRoute ? { agentOptions: effectiveRoute } : {}),
            ...(composed.setup ? { setup: composed.setup } : {}),
        });
        this.modelResolver.setSessionId(key, childId);
        const oldHandle = record.handle;
        record.sessionId = childId;
        record.agent = created.agent;
        record.handle = created;
        record.agentPreset = composed.agentPreset;
        record.lastActivity = Date.now();
        void oldHandle.dispose().catch(() => { });
        this.logger.info(`session rebuilt via fork: key=${key} preset=${composed.agentPreset ?? 'none'} sessionId=${childId}`);
    }
    clearModelOverride(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        this.summonDeadlines.delete(key);
        this.modelResolver.clearOverride(key);
        this.modelResolver.clearSessionId(key);
    }
    async listAvailableModels() {
        return this.modelResolver.listModels();
    }
    listProviders() {
        return this.modelResolver.listProviders();
    }
    // ── 会话状态 / 统计 ──
    getSessionRecord(scope, peerId) {
        return this.sessions.get(this.sessionKey(scope, peerId));
    }
    getStatus(scope, peerId) {
        const record = this.getSessionRecord(scope, peerId);
        const route = this.getEffectiveModel(scope, peerId);
        return {
            active: !!record,
            sessionId: record?.sessionId,
            provider: route?.provider,
            model: route?.model,
            preset: record?.agentPreset,
            lastActivity: record?.lastActivity,
            messageCount: this.countMessages(record),
        };
    }
    getTokenUsage(scope, peerId) {
        const record = this.getSessionRecord(scope, peerId);
        const stats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        const events = record?.agent.session.events;
        if (!events)
            return stats;
        for (const event of events) {
            if (event.type !== 'assistant/message' || !event.usage)
                continue;
            stats.input += event.usage.input ?? 0;
            stats.output += event.usage.output ?? 0;
            stats.cacheRead += event.usage.cacheRead ?? 0;
            stats.cacheWrite += event.usage.cacheWrite ?? 0;
        }
        return stats;
    }
    exportMarkdown(scope, peerId) {
        const record = this.getSessionRecord(scope, peerId);
        if (!record)
            return '';
        const events = record.agent.session.events;
        if (!events || events.length === 0)
            return '';
        const lines = [`# QQ 会话导出\n`, `> session: ${record.sessionId}\n`];
        for (const event of events) {
            if (event.type === 'user/message') {
                const text = extractMessageText(event.message);
                if (text)
                    lines.push(`## 用户\n\n${text}\n`);
            }
            else if (event.type === 'assistant/message') {
                const text = extractMessageText(event.message);
                if (text)
                    lines.push(`## 助手\n\n${text}\n`);
            }
        }
        return lines.join('\n');
    }
    countMessages(record) {
        const events = record?.agent.session.events;
        if (!events)
            return 0;
        let count = 0;
        for (const event of events) {
            if (event.type === 'user/message' || event.type === 'assistant/message') {
                count += 1;
            }
        }
        return count;
    }
    // ── Session 生命周期管理 ──
    sessionKey(scope, peerId) {
        return `qqbot:${this.config.appId}:${scope}:${peerId}`;
    }
    deriveSessionId(sessionKey) {
        const hash = createHash('sha256').update(sessionKey).digest('hex');
        return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    }
    currentSessionId(sessionKey) {
        return this.modelResolver.getSessionId(sessionKey) ?? this.deriveSessionId(sessionKey);
    }
    async composePreset(presetId) {
        const presets = this.getPresetsService();
        if (!presets)
            return {};
        try {
            const resolved = await presets.resolve(presetId);
            const resolvedId = resolved.id;
            return {
                agentPreset: resolvedId,
                setup: async (agentCtx) => {
                    await presets.mount(agentCtx, resolvedId);
                },
            };
        }
        catch (err) {
            this.logger.warn(`im-qqbot: preset ${presetId ?? '(default)'} unavailable: ${err instanceof Error ? err.message : String(err)} — using host composition`);
            return {};
        }
    }
    /** 获取或恢复或创建会话（get → resume → create） */
    async getOrCreate(scope, peerId, senderId, replyTarget) {
        const key = this.sessionKey(scope, peerId);
        const existing = this.sessions.get(key);
        if (existing) {
            existing.replyTarget = replyTarget;
            existing.lastActivity = Date.now();
            this.touchSummon(key);
            return existing;
        }
        // 懒过期兜底：上次进程遗留的召唤截止时间已过 → 建会话前就改回默认路由
        this.expireSummonIfDue(key);
        const route = this.modelResolver.getEffectiveRoute(key);
        const sessionId = SessionId(this.currentSessionId(key));
        this.logger.info(`getOrCreate: key=${key} route=${route ? `${route.provider}/${route.model}` : 'host-default'} sessionId=${sessionId}`);
        let agent;
        let handle;
        let agentPreset;
        const live = this.agents.get(sessionId);
        if (live) {
            agent = live;
            this.logger.info(`reusing live agent: key=${key}`);
        }
        else {
            // preset 只解析一次：resume/create 共用同一组合，避免重复 resolve/mount 目录。
            // 优先 session 当初的 preset（started 锁定语义），无则用当前 effective preset。
            const presetId = (await this.resolvePersistedPreset(sessionId)) ?? this.getEffectivePresetByKey(key);
            const composed = await this.composePreset(presetId);
            agentPreset = composed.agentPreset;
            try {
                const resumeRoute = this.modelResolver.getResumeRoute(key);
                const resumed = await this.agents.resume({
                    resumeSessionId: sessionId,
                    ...(resumeRoute ? { agentOptions: resumeRoute } : {}),
                    ...(composed.setup ? { setup: composed.setup } : {}),
                });
                agent = resumed.agent;
                handle = resumed;
                this.logger.info(`resumed session: key=${key} preset=${agentPreset ?? 'none'} route=${resumeRoute ? `${resumeRoute.provider}/${resumeRoute.model}` : 'session-own'}`);
            }
            catch {
                const created = await this.agents.create({
                    sessionId,
                    meta: {
                        cwd: this.config.cwd || process.cwd(),
                        ...(agentPreset ? { agentPreset } : {}),
                    },
                    ...(route ? { agentOptions: route } : {}),
                    ...(composed.setup ? { setup: composed.setup } : {}),
                });
                agent = created.agent;
                handle = created;
                this.logger.info(`created new session: key=${key} preset=${agentPreset ?? 'none'}`);
            }
        }
        const record = {
            sessionKey: key,
            sessionId,
            agent,
            handle: handle ?? { agent, dispose: async () => { } },
            replyTarget,
            scope,
            peerId,
            senderId,
            lastActivity: Date.now(),
            agentPreset,
        };
        this.sessions.set(key, record);
        return record;
    }
    findBySessionId(sessionId) {
        for (const record of this.sessions.values()) {
            if (record.sessionId === sessionId)
                return record;
        }
        return undefined;
    }
    findByAgent(agent) {
        for (const record of this.sessions.values()) {
            if (record.agent === agent)
                return record;
        }
        return undefined;
    }
    async remove(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        const record = this.sessions.get(key);
        this.summonDeadlines.delete(key);
        this.modelResolver.setSessionId(key, randomUUID());
        if (!record)
            return;
        this.sessions.delete(key);
        record.agent.cancel({ kind: 'user' });
        await record.handle.dispose().catch(() => { });
        this.logger.info(`session removed: key=${key}`);
    }
    /**
     * 原地压缩当前会话历史（保留 sessionId，用摘要替换旧历史）。
     *
     * 需通过 agentPresets.serviceFor(agent, 'compaction') 解析；未挂载时优雅降级。
     * 这是「压缩上下文」的语义，区别于 remove() 的「换新会话」。
     */
    async compact(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        const record = this.sessions.get(key);
        if (!record)
            return { ok: false, reason: 'no-session' };
        if (record.agent.status !== 'idle')
            return { ok: false, reason: 'busy' };
        let compaction;
        try {
            const presets = this.getPresetsService();
            compaction = (presets?.serviceFor(record.agent, 'compaction') ?? this.ctx.get('compaction'));
        }
        catch {
            compaction = undefined;
        }
        if (!compaction)
            return { ok: false, reason: 'unavailable' };
        const route = this.modelResolver.getEffectiveRoute(key);
        const agentCtx = {
            session: record.agent.session,
            options: { provider: route?.provider, model: route?.model },
            runMaintenance: record.agent.runMaintenance.bind(record.agent),
        };
        try {
            const result = await compaction.compactNow(agentCtx, new AbortController().signal);
            if (result === null)
                return { ok: true, shadowed: 0, tokens: 0 };
            return { ok: true, shadowed: result.shadowedSeqs.length, tokens: result.shadowedTokenCount };
        }
        catch (err) {
            const code = err?.code;
            // summary = 摘要没有更小 = 历史不足以压缩，属正常结果而非失败
            if (code === 'summary') {
                return { ok: true, shadowed: 0, tokens: 0 };
            }
            // 其他 ManualCompactionError 预期失败，给友好文案（debug 记录，不 warn 刷屏）
            if (code !== undefined && code in COMPACTION_ERROR_HINTS) {
                this.logger.debug(`compact declined: key=${key} code=${code}`);
                return { ok: false, reason: 'failed', message: COMPACTION_ERROR_HINTS[code] };
            }
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`compact failed: key=${key} err=${message}`);
            return { ok: false, reason: 'failed', message };
        }
    }
    async disposeAll() {
        this.evictor.dispose();
        const records = [...this.sessions.values()];
        this.sessions.clear();
        for (const record of records) {
            record.agent.cancel({ kind: 'user' });
        }
        await Promise.allSettled(records.map((r) => r.handle.dispose()));
        this.logger.info(`all sessions disposed (count=${records.length})`);
    }
    // ── 千金大小姐：本地模型召唤 / 闲置回流 ──
    /** 配置里的本地模型目标（`model` 留空表示自动挑 qwen） */
    summonTarget() {
        const cfg = this.config.summon;
        if (!cfg?.enabled)
            return undefined;
        const provider = (cfg.local?.provider ?? '').trim();
        const model = (cfg.local?.model ?? '').trim();
        return provider ? { provider, model } : undefined;
    }
    /** 路由是否就是本地模型（容忍 `qwen/xxx` 前缀形态与自动挑选） */
    isSummonRoute(route) {
        const target = this.summonTarget();
        if (!target || !route)
            return false;
        if (route.provider !== target.provider)
            return false;
        if (!target.model)
            return /qwen/i.test(String(route.model));
        return route.model === target.model || String(route.model).endsWith(`/${target.model}`);
    }
    summonIdleMs() {
        const value = Number(this.config.summon?.idleRevertMs);
        return Number.isFinite(value) && value > 0 ? value : 20 * 60 * 1000;
    }
    /** 回流路由：显式配置 > 宿主 agentDefaultModel > settings.yaml > 兜底 */
    resolveRevertRoute() {
        const cfg = this.config.summon ?? {};
        const effort = (cfg.revertReasoningEffort ?? '').trim();
        const withEffort = (route) => (effort ? { ...route, reasoningEffort: effort } : { ...route });
        const provider = (cfg.revertProvider ?? '').trim();
        const model = (cfg.revertModel ?? '').trim();
        if (provider && model)
            return withEffort({ provider, model });
        try {
            const selection = this.ctx.get('agentDefaultModel')?.currentSelection?.();
            if (selection?.provider && selection?.model)
                return withEffort({ provider: selection.provider, model: selection.model });
        }
        catch {
            // 服务缺失时静默回落到默认链
        }
        return withEffort(this.modelResolver.resolveDefault());
    }
    /** 回流路由的人类可读描述（确认文案 / 日志） */
    describeRevertRoute() {
        const route = this.resolveRevertRoute();
        const effort = route.reasoningEffort ? ` (reasoning=${route.reasoningEffort})` : '';
        return `${route.provider}/${route.model}${effort}`;
    }
    /** 进入召唤模式：切到本地模型并开始闲置计时 */
    async enterSummon(scope, peerId, route) {
        const key = this.sessionKey(scope, peerId);
        await this.setModelOverride(scope, peerId, route);
        this.summonDeadlines.set(key, Date.now() + this.summonIdleMs());
        this.logger.info(`summon: key=${key} → ${route.provider}/${route.model} (idle ${Math.round(this.summonIdleMs() / 60000)}min)`);
    }
    /** 主动叫回默认模型（清掉本地模型覆盖，切到宿主默认 + reasoningEffort） */
    async exitSummon(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        this.summonDeadlines.delete(key);
        const route = this.resolveRevertRoute();
        await this.setModelOverride(scope, peerId, route);
        this.logger.info(`summon: manual exit key=${key} → ${route.provider}/${route.model}`);
        return route;
    }
    /** 每条消息刷新闲置倒计时（只在召唤模式内生效） */
    touchSummon(key) {
        if (this.summonDeadlines.has(key)) {
            this.summonDeadlines.set(key, Date.now() + this.summonIdleMs());
            return;
        }
        if (this.isSummonRoute(this.modelResolver.getEffectiveRoute(key))) {
            this.summonDeadlines.set(key, Date.now() + this.summonIdleMs());
        }
    }
    /** 懒过期：建会话前若已超时，先把持久化覆盖改回默认路由 */
    expireSummonIfDue(key) {
        const deadline = this.summonDeadlines.get(key);
        if (deadline === undefined || Date.now() < deadline)
            return;
        this.summonDeadlines.delete(key);
        this.modelResolver.setOverride(key, this.resolveRevertRoute());
        this.logger.info(`summon: expired before resume key=${key} → revert`);
    }
    /** 闲置巡检：到点的活跃会话切回默认模型（turn 仍在跑则跳过，下一轮再试） */
    async sweepSummon(now = Date.now()) {
        for (const record of [...this.sessions.values()]) {
            const key = record.sessionKey;
            const deadline = this.summonDeadlines.get(key);
            if (deadline === undefined || now < deadline)
                continue;
            if (!this.isSummonRoute(this.modelResolver.getEffectiveRoute(key))) {
                // 已被 /model 手动切走，清掉残留计时
                this.summonDeadlines.delete(key);
                continue;
            }
            if (record.agent.status !== 'idle')
                continue;
            try {
                this.summonDeadlines.delete(key);
                const route = this.resolveRevertRoute();
                await this.setModelOverride(record.scope, record.peerId, route);
                this.logger.info(`summon: idle revert key=${key} → ${route.provider}/${route.model}`);
            }
            catch (err) {
                this.logger.warn(`summon: idle revert failed key=${key} err=${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    /**
     * 启动时清掉上一进程遗留的本地模型覆盖。
     * 进程重启后无法判断是否已闲置超时，按「已退出召唤模式」处理，
     * 避免本地模型没开时一直卡在不可用的路由上。
     */
    clearStaleSummonOverrides() {
        if (!this.summonTarget())
            return;
        let cleared = 0;
        for (const [key, route] of [...this.modelResolver.prefs.overrides]) {
            if (this.isSummonRoute(route)) {
                this.modelResolver.clearOverride(key);
                cleared += 1;
            }
        }
        if (cleared > 0)
            this.logger.info(`summon: cleared ${cleared} stale local-model override(s) on boot`);
    }
    get size() {
        return this.sessions.size;
    }
}
/** 从消息对象中提取纯文本（用于导出/统计） */
function extractMessageText(message) {
    const blocks = message?.content;
    if (!blocks || !Array.isArray(blocks))
        return '';
    const parts = [];
    for (const block of blocks) {
        if (block.type === 'text' && block.text) {
            parts.push(block.text);
        }
    }
    return parts.join('\n').trim();
}
//# sourceMappingURL=session-manager.js.map