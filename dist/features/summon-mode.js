/**
 * 千金大小姐模式 —— 模型判定式召唤 / 双向交接。
 *
 * 判定：不做硬编码短语匹配。先用「称呼词 + 动作词 + 目标词」做宽松预筛，
 * 命中的消息交给裁判模型（默认宿主默认模型）判一次，返回
 * `{summon, target}`；只有模型说「是」才动手。这样「大肥鱼叫千问上号」
 * 「神鲸一代目，把千金大小姐喊来」这类变体都能覆盖，也不用带括号。
 *
 * 投递：群聊里没 @ 的消息本来会被 mentionGate 拦掉，这里用
 * isSummonCandidate 作为 isImplicitMention 的探测条件放行候选消息；
 * 裁判说不是时直接丢弃，避免机器人接群里的闲聊。
 *
 * 交接：切本地 = 复制当前会话给一个新 agent（新模型）并把旧 agent 下线；
 * 切回默认 = 回到宿主 agentDefaultModel 的模型并强制 reasoningEffort。
 * 默认模型路由每次运行时解析，不写死 id。
 */
import { getScopePeer } from "../shared/index.js";
/** 去掉 @ 标记后的正文 */
function plainText(content) {
    return String(content ?? '').replace(/<@!?[^>]+>\s*/g, '').trim();
}
/** `|` 分隔的列表 */
export function parseList(raw) {
    return String(raw ?? '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
}
/** 消息是否已经明确指向机器人（@ 了，或本来就在私聊） */
function addressedByMention(message) {
    if (message?.kind !== 'group')
        return true;
    return message.rawEventType === 'GROUP_AT_MESSAGE_CREATE' ||
        Boolean(message.mentions?.some((m) => m?.is_you));
}
/** 汇总一次判定要用到的词表 */
export function summonVocabulary(config, botName) {
    const cfg = config?.summon ?? {};
    const addresses = [...new Set([...parseList(cfg.addresses), ...parseList(botName)])];
    return {
        addresses,
        localNames: parseList(cfg.local?.names),
        hostNames: parseList(cfg.host?.names),
        cues: parseList(cfg.cues),
    };
}
/**
 * 投递预筛：够宽，只排除「完全不像」的闲聊。
 *
 * 群聊未 @ 时用它决定是否把消息放进链路（交给裁判）；私聊/@ 的消息
 * 本来就进得来，这里只用来省一次裁判调用。
 */
export function isSummonCandidate(message, config, botName) {
    const cfg = config?.summon;
    if (!cfg?.enabled)
        return false;
    const text = plainText(message?.content);
    if (!text)
        return false;
    const { addresses, localNames, hostNames, cues } = summonVocabulary(config, botName);
    const hasTarget = [...localNames, ...hostNames].some((n) => text.includes(n));
    if (!hasTarget)
        return false;
    if (!cues.some((c) => text.includes(c)))
        return false;
    return addressedByMention(message) || addresses.some((a) => text.includes(a));
}
/**
 * 消息是否在「叫机器人名字」（群聊免 @ 的普通对话入口）。
 *
 * 只认开头：称呼词出现在消息最前面才算（允许前导标点/空格），
 * 避免群里聊到「deepseek 好慢」「大肥鱼今天没来」也被当成在叫它。
 */
export function isCalledByName(message, config, botName) {
    if (message?.kind !== 'group')
        return false;
    const cfg = config?.summon;
    if (!cfg?.enabled || cfg.callByName === false)
        return false;
    const text = plainText(message?.content).replace(/^[\s，。！？、,.!?~～…@]+/, '');
    if (!text)
        return false;
    const { addresses } = summonVocabulary(config, botName);
    return addresses.some((name) => text.startsWith(name));
}
/**
 * 解析本地模型路由。
 *
 * `local.model` 留空时自动挑该 provider 下第一个 qwen（找不到就取第一个），
 * 这样换本地模型不用改配置。
 */
export function resolveLocalRoute(local, models) {
    const provider = (local?.provider ?? '').trim();
    if (!provider)
        return undefined;
    const want = (local?.model ?? '').trim();
    const candidates = (models ?? []).filter((m) => m?.provider === provider);
    let model = want;
    if (!model) {
        const qwen = candidates.find((m) => /qwen/i.test(String(m.id)));
        model = qwen?.id ?? candidates[0]?.id ?? '';
    }
    else if (candidates.length > 0 && !candidates.some((m) => m.id === model)) {
        const suffix = candidates.filter((m) => String(m.id).endsWith(`/${model}`));
        if (suffix.length === 1)
            model = suffix[0].id;
    }
    return model ? { provider, model } : undefined;
}
/** 判定用的提示词：把词表和规则都交给模型，允许模糊表述 */
function buildJudgePrompt(text, config, botName) {
    const { addresses, localNames, hostNames } = summonVocabulary(config, botName);
    return [
        '你是意图分类器。判断说话人这句话是不是在「叫某个模型上号/接手对话」。',
        '',
        `称呼机器人的词：${addresses.join('、') || '（无）'}`,
        `可以叫上来的本地模型：${localNames.join('、') || '（无）'}`,
        `当前默认模型：${hostNames.join('、') || '（无）'}`,
        '',
        '规则：',
        '- 只有明确要求把某个模型叫上来接手/切换，才算 true。',
        '- 单纯提到名字、讨论、转述、吐槽、假设（如「要是千问在就好了」）都算 false。',
        '- 可能带括号、感叹号、@、错别字、口语化，这些都不影响判断。',
        '- target 只能是 "local"（叫本地模型）或 "host"（叫回默认模型），分不清就用 "local"。',
        '- 只输出一行 JSON，不要解释：{"summon":true,"target":"local"}',
        '',
        `说话人这句话："""${text}"""`,
    ].join('\n');
}
/** 宽松解析裁判输出（模型偶尔会带解释或代码块） */
export function parseVerdict(raw) {
    const text = String(raw ?? '');
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
        try {
            const obj = JSON.parse(match[0]);
            return {
                summon: obj?.summon === true,
                target: obj?.target === 'host' ? 'host' : 'local',
            };
        }
        catch {
            // 落到下面的兜底解析
        }
    }
    return {
        summon: /\btrue\b/i.test(text),
        target: /"host"/i.test(text) ? 'host' : 'local',
    };
}
/** 宿主默认模型选择（裁判模型 + 回流目标的缺省来源） */
function hostSelection(manager) {
    try {
        const selection = manager.ctx?.get?.('agentDefaultModel')?.currentSelection?.();
        if (selection?.provider && selection?.model)
            return selection;
    }
    catch {
        // 服务缺失时走下面的兜底
    }
    try {
        return manager.modelResolver?.resolveDefault?.();
    }
    catch {
        return undefined;
    }
}
/** 调裁判模型，返回 {summon, target} */
async function judgeSummon(manager, config, text, logger) {
    const cfg = config.summon;
    const llm = manager.ctx?.get?.('llm');
    if (!llm || typeof llm.stream !== 'function')
        throw new Error('llm 服务不可用');
    const selection = hostSelection(manager);
    const provider = (cfg.judgeProvider ?? '').trim() || selection?.provider;
    const model = (cfg.judgeModel ?? '').trim() || selection?.model;
    if (!provider || !model)
        throw new Error('裁判模型未配置，且宿主没有默认模型');
    const timeoutMs = Math.max(1000, Number(cfg.judgeTimeoutMs) || 5000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const stream = llm.stream({
            provider,
            model,
            temperature: 0,
            maxTokens: 48,
            signal: controller.signal,
            messages: [
                {
                    role: 'user',
                    content: [{ type: 'text', text: buildJudgePrompt(text, config, manager.botName) }],
                },
            ],
        });
        let out = '';
        for await (const chunk of stream) {
            if (chunk?.type === 'text-delta') {
                out += chunk.text ?? '';
                continue;
            }
            if (chunk?.type === 'finish') {
                if (chunk.reason?.kind === 'error') {
                    throw new Error(chunk.reason.failure?.message ?? 'judge call failed');
                }
                break;
            }
        }
        return parseVerdict(out);
    }
    finally {
        clearTimeout(timer);
    }
}
/** 本地服务健康探测（可选，仅在切本地前执行） */
async function probeHealth(cfg) {
    const url = (cfg?.healthUrl ?? '').trim();
    if (!url)
        return true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
        const response = await fetch(url, { signal: controller.signal });
        return response.ok;
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(timer);
    }
}
async function safeReply(ctx, text) {
    try {
        await ctx.bot.sendText(ctx.replyTarget, text);
    }
    catch {
        // 回复失败不影响交接本身
    }
}
/** 去掉称呼/目标/动作词后还剩什么（只用于判断「纯召唤」还是「召唤+正事」） */
function leftoverText(text, config, botName) {
    const { addresses, localNames, hostNames, cues } = summonVocabulary(config, botName);
    let out = text;
    for (const word of [...localNames, ...hostNames, ...addresses, ...cues]) {
        if (word)
            out = out.split(word).join('');
    }
    return out.replace(/[\s，。！？、,.!?~～…（）()「」【】[\]"']/g, '');
}
export function summonMode({ manager, config, logger }) {
    return async (ctx, next) => {
        const cfg = config.summon;
        if (!isSummonCandidate(ctx.message, config, manager.botName)) {
            await next();
            return;
        }
        const text = plainText(ctx.message.content);
        const addressed = addressedByMention(ctx.message);
        let verdict;
        try {
            verdict = await judgeSummon(manager, config, text, logger);
        }
        catch (err) {
            logger.warn(`summon: judge failed: ${err instanceof Error ? err.message : String(err)}`);
            // 判定不可用时：@/私聊照常回答，群里的候选消息不接（宁可不切也不误接）
            if (addressed) {
                await next();
                return;
            }
            ctx.stop('summon:judge-failed');
            return;
        }
        if (!verdict.summon) {
            logger.debug?.(`summon: judge said no: ${text.slice(0, 60)}`);
            if (addressed) {
                await next();
                return;
            }
            ctx.stop('summon:not-summon');
            return;
        }
        const { scope, peerId } = getScopePeer(ctx);
        const target = verdict.target === 'host' ? 'host' : 'local';
        let route;
        try {
            if (target === 'host') {
                route = manager.resolveRevertRoute();
                await manager.exitSummon(scope, peerId);
            }
            else {
                let models = [];
                try {
                    models = await manager.listAvailableModels();
                }
                catch {
                    // 列表拿不到时按配置/自动选择继续
                }
                route = resolveLocalRoute(cfg.local, models);
                if (route === undefined)
                    throw new Error('本地模型不可用（provider 或 model 未配置）');
                if (!(await probeHealth(cfg)))
                    throw new Error(`本地服务没连上（${cfg.healthUrl}）`);
                await manager.enterSummon(scope, peerId, route);
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn(`summon: handoff failed: ${message}`);
            await safeReply(ctx, `⚠️ 交接失败：${message}`);
            ctx.stop('summon:handoff-failed');
            return;
        }
        // 还有别的事要说 → 交给 agent，用新模型回答
        if (leftoverText(text, config, manager.botName).length > 0) {
            await next();
            return;
        }
        const localLabel = parseList(cfg.local?.names)[0] ?? '本地模型';
        const idleMin = Math.round((Number(cfg.idleRevertMs) || 20 * 60 * 1000) / 60000);
        const revert = typeof manager.describeRevertRoute === 'function'
            ? manager.describeRevertRoute()
            : '宿主默认模型';
        const lines = target === 'host'
            ? [
                `✅ 已叫回默认模型：${route.provider}/${route.model}`,
                `原对话已交接下线。`,
            ]
            : [
                `✅ 已叫 ${localLabel} 上号：${route.provider}/${route.model}`,
                `原对话已交接下线；空闲 ${idleMin} 分钟自动切回 ${revert}。`,
            ];
        await safeReply(ctx, lines.join('\n'));
        ctx.stop(`summon:handoff:${target}`);
    };
}
//# sourceMappingURL=summon-mode.js.map
