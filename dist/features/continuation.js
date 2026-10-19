/**
 * 对话延续判定 —— 解决「机器人分不清别人是不是在跟它说话」。
 *
 * 场景：群里机器人刚回完一句，接下来有人发「哈哈哈」「笑死」「6」「?」，
 * 或者接着它的话吐槽。这些消息既没 @ 也没叫名字，旧门控会直接丢掉，
 * 模型于是永远不知道别人在笑它。
 *
 * 做法：机器人每回完一轮，记下「最后一句 + 时间」；之后 windowMs 内到达的
 * 未寻址群消息，连同这段上下文交给裁判模型判一次：
 * 「这句话是不是在跟机器人说话 / 回应它 / 笑它」。判是就把消息标记为
 * 已寻址（ctx.state.qqbotAddressed），由 mentionGate 放行；判不是就保持安静。
 */
import { isCalledByName, isSummonCandidate } from './summon-mode.js';

/** 每个会话最后一条机器人回复（sessionKey → { text, at }） */
const lastReplies = new Map();
/** 记录机器人刚发出的一条回复 */
export function noteBotReply(sessionKey, text) {
    const value = String(text ?? '').trim();
    if (!sessionKey || !value)
        return;
    lastReplies.set(sessionKey, { text: value.slice(0, 500), at: Date.now() });
    // 防止无限增长：超过 500 个会话时清掉最旧的
    if (lastReplies.size > 500) {
        const oldest = [...lastReplies.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest)
            lastReplies.delete(oldest[0]);
    }
}
/** 取机器人在该会话的最后一条回复 */
export function lastBotReply(sessionKey) {
    return lastReplies.get(sessionKey);
}
/** 测试/调试用：清空记录 */
export function clearBotReplies() {
    lastReplies.clear();
}
function plainText(content) {
    return String(content ?? '').replace(/<@!?[^>]+>\s*/g, '').trim();
}
function addressedByMention(message) {
    return message?.rawEventType === 'GROUP_AT_MESSAGE_CREATE' || Boolean(message?.mentions?.some((m) => m?.is_you));
}
/** 组装裁判提示词：机器人上一句 + 之后的群聊 + 当前这条 */
export function buildContinuationPrompt({ botReply, history, current }) {
    const lines = [];
    const recent = (history ?? []).slice(-8);
    for (const item of recent) {
        const name = item.senderName || String(item.senderId ?? '').slice(0, 8);
        lines.push(`${name}：${plainText(item.content)}`);
    }
    const sender = current?.senderName || String(current?.senderId ?? '').slice(0, 8);
    return [
        '你是群聊意图判断器。机器人（一个群友）刚在群里说完话，现在来了一条新消息。',
        '判断这条消息是不是在跟机器人说话：接它的话、回答它、问它、反驳它、笑它/嘲讽它、拿它开玩笑。',
        '注意：',
        '- 如果只是群友之间聊天、跟机器人的话无关，返回 false。',
        '- 如果是在笑机器人的上一句（例如它说错话后别人发「哈哈哈」「笑死」「6」），返回 true。',
        '- 只要是语义上在回应机器人就算 true，不要求叫名字或 @。',
        '- 只输出一行 JSON，不要解释：{"addressed":true}',
        '',
        '机器人最后一条消息：',
        `"""${botReply}"""`,
        '',
        recent.length > 0 ? `这之后的群聊：\n${lines.join('\n')}` : '这之后没有别的消息。',
        '',
        `当前这条：\n${sender}：${plainText(current?.content)}`,
    ].join('\n');
}
/** 宽松解析裁判输出 */
export function parseContinuationVerdict(raw) {
    const text = String(raw ?? '');
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
        try {
            const obj = JSON.parse(match[0]);
            return obj?.addressed === true;
        }
        catch {
            // 落到下面兜底
        }
    }
    return /\btrue\b/i.test(text);
}
/** 调裁判模型 */
async function judgeContinuation(manager, config, prompt, logger) {
    const cfg = config.continuation ?? {};
    const llm = manager.ctx?.get?.('llm');
    if (!llm || typeof llm.stream !== 'function')
        throw new Error('llm 服务不可用');
    let selection;
    try {
        selection = manager.ctx?.get?.('agentDefaultModel')?.currentSelection?.();
    }
    catch {
        selection = undefined;
    }
    const provider = String(cfg.judgeProvider ?? '').trim() || selection?.provider || manager.modelResolver?.resolveDefault?.()?.provider;
    const model = String(cfg.judgeModel ?? '').trim() || selection?.model || manager.modelResolver?.resolveDefault?.()?.model;
    if (!provider || !model)
        throw new Error('裁判模型未配置');
    const timeoutMs = Math.max(1000, Number(cfg.judgeTimeoutMs) || 5000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const stream = llm.stream({
            provider,
            model,
            temperature: 0,
            maxTokens: 32,
            signal: controller.signal,
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        });
        let out = '';
        for await (const chunk of stream) {
            if (chunk?.type === 'text-delta') {
                out += chunk.text ?? '';
                continue;
            }
            if (chunk?.type === 'finish') {
                if (chunk.reason?.kind === 'error')
                    throw new Error(chunk.reason.failure?.message ?? 'judge call failed');
                break;
            }
        }
        return parseContinuationVerdict(out);
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * 对话延续中间件：放在 historyBuffer 之后、mentionGate 之前。
 *
 * 只处理「群聊 + 未寻址 + 不是召唤候选」的消息，避免抢召唤/叫名字的活。
 */
export function continuationGate({ manager, config, logger }) {
    return async (ctx, next) => {
        const cfg = config.continuation;
        if (!cfg?.enabled || ctx.message?.kind !== 'group') {
            await next();
            return;
        }
        if (addressedByMention(ctx.message))
            return next();
        if (isSummonCandidate(ctx.message, config, manager.botName) || isCalledByName(ctx.message, config, manager.botName)) {
            return next();
        }
        const scope = 'group';
        const peerId = ctx.message.groupOpenid ?? ctx.message.senderId;
        const key = manager.sessionKey(scope, peerId);
        const last = lastBotReply(key);
        const windowMs = Number(cfg.windowMs) || 180000;
        if (!last || !last.text || Date.now() - last.at > windowMs) {
            return next();
        }
        try {
            const prompt = buildContinuationPrompt({
                botReply: last.text,
                history: ctx.state?.history ?? [],
                current: ctx.message,
            });
            const addressed = await judgeContinuation(manager, config, prompt, logger);
            if (addressed) {
                ctx.state.qqbotAddressed = true;
                logger.info(`im-qqbot: continuation accepted sender=${ctx.message.senderId}`);
            }
            else {
                logger.debug?.(`im-qqbot: continuation rejected sender=${ctx.message.senderId}`);
            }
        }
        catch (err) {
            // 判定失败保持安静：宁可漏接，也不要让机器人乱插话
            logger.warn(`im-qqbot: continuation judge failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        await next();
    };
}
//# sourceMappingURL=continuation.js.map
