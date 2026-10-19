import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { classifyContentType, isVoiceContentType, } from "./attachment.js";
import { clearGroupHistory } from "../features/history-store.js";
import { readArchive } from "../features/chat-archive.js";
import { noteBotReply } from "../features/continuation.js";
/** 「想回看」的粗判：命中就自动附上归档片段，不依赖模型是否会调工具 */
const ARCHIVE_INTENT = /看(?:看|下|一下)?[\s\S]{0,6}(?:消息|聊天|记录|图|照片|截图)|(?:刚才|刚刚|之前|昨天|前天|历史|前面)[\s\S]{0,6}(?:说|聊|发|讲|提)/;
// ── 主处理函数 ──
/**
 * 处理 QQ 入站消息（已经过 SDK 中间件链）
 */
export async function handleInbound(ctx, manager, config, logger) {
    const msg = ctx.message;
    const mwState = ctx.state;
    const { bot } = ctx;
    const scope = msg.kind === 'group' ? 'group' : 'c2c';
    const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;
    const replyTarget = {
        scope,
        targetId: peerId,
        msgId: msg.messageId,
    };
    // ── 组装 agentBody（下载结果经 mwState.downloadedFiles 提供） ──
    const agentBody = assembleAgentBody(msg, mwState, scope, logger, config);
    if (!agentBody)
        return;
    logger.info(`Processing: scope=${scope} peerId=${peerId} body="${agentBody.slice(0, 200)}"`);
    // ── 获取或创建会话 ──
    let record;
    try {
        record = await manager.getOrCreate(scope, peerId, msg.senderId, replyTarget);
    }
    catch (err) {
        logger.error(`ERROR creating session: ${err instanceof Error ? err.message : String(err)}`);
        // 兜底回复：会话创建失败时告知用户，避免静默无响应
        try {
            await bot.sendMarkdown(replyTarget, '⚠️ 处理消息时出现异常，请稍后重试。');
        }
        catch (sendErr) {
            logger.error(`fallback reply failed: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
        }
        return;
    }
    // ── 构建 UserMessage → followup ──
    const content = [{ type: 'text', text: agentBody }];
    const message = createUserMessage({
        content,
        source: { kind: 'user' },
    });
    record.agent.followup(message);
    logger.info(`→ followup sent: key=${scope}:${peerId}`);
    // 群消息回复后清空历史缓存（避免下次 @ 时重复组包）
    if (scope === 'group') {
        clearGroupHistory(config.appId, msg.groupOpenid ?? msg.senderId);
    }
    // 阻塞等待本轮 turn 收敛，避免后续消息在 turn 运行期间被 followup 打断
    try {
        await record.agent.whenIdle();
    }
    catch (err) {
        logger.warn(`whenIdle rejected: ${err instanceof Error ? err.message : String(err)}`);
    }
    // 记下机器人刚说的最后一句，供「对话延续」判定使用（别人笑它/接话时才有上下文）
    try {
        noteBotReply(manager.sessionKey(scope, peerId), lastAssistantText(record));
    }
    catch {
        // 记录失败不影响主流程
    }
}
/** 取最近一条 assistant 文本（用于延续判定的上下文） */
function lastAssistantText(record) {
    const events = record?.agent?.session?.events ?? [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event?.type !== 'assistant/message')
            continue;
        const blocks = event.data?.message?.content ?? [];
        const text = blocks
            .filter((block) => block?.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('\n')
            .trim();
        if (text)
            return text;
    }
    return '';
}
// ══════════════════════════════════════════════════════════════
// Body Assembly（5 层组装）
// ══════════════════════════════════════════════════════════════
/**
 * 组装 agentBody — AI 实际看到的完整上下文
 */
function assembleAgentBody(msg, state, scope, logger, config) {
    const isGroup = scope === 'group';
    const wasMentioned = state.mention?.wasMentioned ?? false;
    const userContent = buildUserContent(msg, state, logger);
    if (isEmptyMessage(userContent, msg.attachments, isGroup, wasMentioned))
        return null;
    const quotePart = buildQuotePart(state.quote);
    const userMessage = buildUserMessage(userContent, quotePart, msg.senderId, msg.senderName, isGroup, wasMentioned);
    const dynamicCtx = buildDynamicCtx(msg, state);
    const archiveCtx = buildArchiveContext(config, scope, msg, userContent);
    // 对话延续判定通过的消息：明确告诉模型「这条是接你上一句的」，避免它当成路人聊天
    const addressedNote = state.qqbotAddressed === true ? '[这条消息是在回应你刚才说的话]\n' : '';
    const base = `${archiveCtx}${dynamicCtx}${addressedNote}${userMessage}`;
    const agentBody = buildAgentBody(base, state.history, isGroup, wasMentioned);
    return agentBody;
}
/**
 * 归档上下文：用户明确想看之前的消息/图片时，直接把最近 20 条拼进本轮输入。
 *
 * 这样即使当前模型不支持工具调用（本地小模型常见），也能「自动去查」；
 * 想翻更早的内容再由模型调用 qqbot_chat_log。
 */
function buildArchiveContext(config, scope, msg, userContent) {
    if (config?.archive?.enabled === false)
        return '';
    if (!userContent || !ARCHIVE_INTENT.test(userContent))
        return '';
    const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;
    try {
        const archive = readArchive(config, scope, peerId, { limit: 20 });
        if (!archive.exists || !archive.text)
            return '';
        const pics = archive.images.length > 0 ? `\n图片路径: ${archive.images.join(', ')}` : '';
        return `[会话归档 · 最近记录]\n${archive.text}${pics}\n[归档结束；需要更早的内容可调用 qqbot_chat_log]\n\n`;
    }
    catch {
        return '';
    }
}
/**
 * 判断消息是否为空：无文本/语音/附件，且非群聊 @。
 * 群聊被 @ 视为有效触发信号，即使内容为空也保留给 agent。
 */
function isEmptyMessage(userContent, attachments, isGroup, wasMentioned) {
    if (userContent)
        return false;
    if (attachments && attachments.length > 0)
        return false;
    if (isGroup && wasMentioned)
        return false;
    return true;
}
/**
 * Layer 1: 用户文本内容 + 语音转录 + 附件类型标签（媒体路径由 buildDynamicCtx 提供）
 */
function buildUserContent(msg, state, logger) {
    const parts = [];
    const text = (msg.content ?? '').trim();
    if (text) {
        parts.push(text);
    }
    const voiceTexts = extractVoiceTexts(msg.attachments, state.processedAttachments, logger);
    if (voiceTexts.length > 0) {
        for (const vt of voiceTexts) {
            const durationTag = vt.duration ? ` (${vt.duration}s)` : '';
            parts.push(`[Voice message${durationTag}] ${vt.text}`);
        }
    }
    // 附件类型标签（媒体路径由 buildDynamicCtx 提供，这里只提示「带了什么」）
    const attachmentTags = buildAttachmentTags(msg.attachments);
    if (attachmentTags) {
        parts.push(attachmentTags);
    }
    return parts.join('\n');
}
/**
 * Layer 2: 引用消息块
 */
function buildQuotePart(quote) {
    if (!quote?.text && !quote?.entry?.content)
        return '';
    const quoteText = quote.text || quote.entry?.content || 'Original content unavailable';
    return `[Quoted message begins]\n${quoteText}\n[Quoted message ends]\n[Current message]\n`;
}
/**
 * Layer 3: 带发送者标签的用户消息
 */
function buildUserMessage(userContent, quotePart, senderId, senderName, isGroup, wasMentioned) {
    if (!isGroup) {
        return `${quotePart}${userContent}`;
    }
    const mentionTag = wasMentioned ? ' (@you)' : '';
    const displayName = senderName ?? shortSenderId(senderId);
    const senderTag = `[${displayName} (${senderId})]`;
    return `${quotePart}${senderTag} ${userContent}${mentionTag}`;
}
/**
 * Layer 4: 媒体元数据上下文（图片/视频/文件本地路径 + 语音 ASR + 引用附件）
 */
function buildDynamicCtx(msg, state) {
    const lines = [];
    if (msg.attachments && msg.attachments.length > 0) {
        const downloadedByFilename = new Map((state.downloadedFiles ?? []).map(d => [d.filename, d]));
        const voices = [];
        // 一次遍历归类 + 生成媒体行
        for (const att of msg.attachments) {
            const kind = classifyContentType(att.content_type);
            if (kind === 'voice') {
                voices.push(att);
                continue;
            }
            const d = downloadedByFilename.get(att.filename);
            lines.push(`- ${renderMediaLine(kind, att.filename, d?.localPath, att.url, att.size)}`);
        }
        // 语音：有 ASR 文本才带文本，否则只带链接（纯文本模型无法消费音频）
        if (voices.length > 0) {
            const asrTexts = voices.map(a => a.asr_refer_text).filter(Boolean);
            if (asrTexts.length > 0) {
                lines.push(`- ASR: ${asrTexts.join(' | ')}`);
            }
            else {
                const urls = voices.map(a => a.url).filter(Boolean);
                if (urls.length > 0)
                    lines.push(`- Voice: ${urls.join(', ')}`);
            }
        }
    }
    // 引用消息的附件（独立于当前消息媒体，不受上一步为空影响）
    const quoteAttachments = state.quote?.attachments;
    if (quoteAttachments && quoteAttachments.length > 0) {
        const downloadedQuote = new Map((state.downloadedQuoteFiles ?? []).map(d => [d.filename, d]));
        lines.push('[Reference attachments]');
        for (const qa of quoteAttachments) {
            const kind = classifyContentType(qa.contentType);
            const d = downloadedQuote.get(qa.filename ?? '');
            if (kind === 'voice') {
                if (qa.asrText)
                    lines.push(`  - Voice: ${qa.asrText}`);
                continue;
            }
            lines.push(`  - ${renderMediaLine(kind, qa.filename, d?.localPath, qa.url, undefined)}`);
        }
    }
    return lines.length > 0 ? lines.join('\n') + '\n\n' : '';
}
/**
 * 渲染单个媒体附件（image/video/file）的上下文行内容，不含列表前缀。
 * 当前消息与引用消息共用，保证附件格式统一。语音不在此处理（见 buildDynamicCtx）。
 */
function renderMediaLine(kind, filename, localPath, url, size) {
    switch (kind) {
        case 'image':
            return localPath
                ? `Image: ${localPath}`
                : `Image: ${url ?? filename ?? 'image'}`;
        case 'video':
            return localPath
                ? `Video: ${localPath}`
                : `Video: ${filename ?? 'video'} (download failed)`;
        case 'file':
            return localPath
                ? `File: ${localPath}`
                : `File: ${filename ?? 'file'} (${formatFileSize(size ?? 0)})`;
    }
}
/**
 * Layer 5: 最终 agentBody 拼合
 */
function buildAgentBody(base, history, isGroup, _wasMentioned) {
    // 群聊历史对所有进入链路的消息都带上（含免 @ 的对话延续），
    // 否则模型不知道别人刚才在聊什么、在笑什么。
    if (!isGroup || !history || history.length === 0) {
        return base;
    }
    const historyLines = history.map(h => {
        const name = h.senderName ?? shortSenderId(h.senderId);
        return `[${name} (${h.senderId})] ${h.content}`;
    });
    return [
        '[Chat history begins]',
        ...historyLines,
        '',
        '[Chat history ends]',
        '[Current message]',
        base,
    ].join('\n');
}
function extractVoiceTexts(attachments, processed, _logger) {
    const results = [];
    if (processed) {
        for (const pa of processed) {
            if (pa.type === 'voice' && pa.voiceText) {
                results.push({
                    text: pa.voiceText,
                    duration: pa.duration,
                    source: pa.voiceSource ?? 'stt',
                });
            }
        }
    }
    if (results.length === 0 && attachments) {
        for (const att of attachments) {
            if (isVoiceContentType(att.content_type) && att.asr_refer_text) {
                results.push({
                    text: att.asr_refer_text.trim(),
                    source: 'asr',
                });
            }
        }
    }
    return results;
}
/**
 * 附件类型标签（Layer 1 用户消息主体里的轻量提示）。
 * 只标注「带了什么类型的附件」，去重；媒体本地路径在 buildDynamicCtx 提供。
 */
function buildAttachmentTags(attachments) {
    if (!attachments || attachments.length === 0)
        return '';
    const labels = {
        image: '[图片]',
        video: '[视频]',
        file: '[文件]',
    };
    const seen = new Set();
    const tags = [];
    for (const att of attachments) {
        const kind = classifyContentType(att.content_type);
        if (kind === 'voice' || seen.has(kind))
            continue;
        seen.add(kind);
        const label = labels[kind];
        if (label)
            tags.push(label);
    }
    return tags.join(' ');
}
function formatFileSize(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
/** 发送者短标识长度（openid 前 N 位，无昵称时兜底） */
const SENDER_SHORT_ID_LEN = 8;
/** 无昵称时用 openid 前 N 位作为匿名标识 */
function shortSenderId(senderId) {
    return senderId.slice(0, SENDER_SHORT_ID_LEN);
}
//# sourceMappingURL=inbound.js.map