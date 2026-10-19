/**
 * 出站事件解析 — 将 dsh session/event 归一化为强类型
 *
 * 原始事件（ctx.on('session/event') 回调参数）是弱类型：
 *   { type: string, data: Record<string, unknown> }
 * 这里把可识别的事件解析为 discriminated union，未知类型或字段缺失返回 undefined。
 */
/**
 * 解析原始事件为强类型
 *
 * 未知类型或缺失关键字段时返回 undefined，由调用方直接跳过。
 */
export function parseEvent(raw) {
    switch (raw.type) {
        case 'assistant/chunk': {
            const chunk = raw.data.chunk;
            if (chunk === undefined || chunk.type !== 'text-delta' || !chunk.text)
                return undefined;
            return { type: 'assistant/chunk', text: chunk.text };
        }
        case 'assistant/message': {
            const message = raw.data.message;
            if (message === undefined || !Array.isArray(message.content))
                return undefined;
            return { type: 'assistant/message', content: message.content };
        }
        case 'tool/call': {
            const data = raw.data;
            if (!data.callId || !data.name)
                return undefined;
            return { type: 'tool/call', callId: data.callId, name: data.name, arguments: data.arguments ?? '' };
        }
        case 'tool/result': {
            const data = raw.data;
            const callId = data.message?.source?.callId;
            if (!callId)
                return undefined;
            return { type: 'tool/result', callId, error: data.error, raw: raw.data };
        }
        case 'turn/end': {
            const reason = raw.data.reason ?? {};
            return { type: 'turn/end', reason };
        }
        default:
            return undefined;
    }
}
/**
 * 从 turn/end reason 提取错误信息
 *
 * 兼容三种形态：error（新格式）、failure（旧格式）、顶层 message/code（最旧格式）。
 */
export function extractTurnError(reason) {
    if (reason.kind !== 'error')
        return undefined;
    const detail = reason.error ?? reason.failure;
    return {
        code: detail?.code ?? reason.code ?? 'UNKNOWN',
        message: detail?.message ?? reason.message ?? 'unknown error',
    };
}
//# sourceMappingURL=events.js.map