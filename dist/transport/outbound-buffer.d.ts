/**
 * OutboundBuffer — 出站文本缓冲
 *
 * 收集流式 chunk，流式优先投递（StreamingWriter），降级为静态发送。
 * 独立文件便于单测。
 */
import type { InlineKeyboard } from '@tencent-connect/qqbot-nodejs';
import type { SessionRecord } from '../session/index.ts';
import type { Logger, ReplyTarget } from '../types.ts';
/** QQ 流式会话（openStream 返回） */
export interface StreamSessionLike {
    update(content: string): Promise<unknown>;
    complete(): Promise<unknown>;
}
/** QQ Bot 发送接口 */
export interface QQBotSender {
    sendMarkdown(target: ReplyTarget, content: string, opts?: {
        keyboard?: InlineKeyboard;
    }): Promise<unknown>;
    openStream(target: ReplyTarget): StreamSessionLike;
}
export declare class OutboundBuffer {
    private buffer;
    private flushing;
    private readonly writer;
    private readonly record;
    private readonly bot;
    private readonly limit;
    private readonly logger;
    constructor(record: SessionRecord, bot: QQBotSender, limit: number, logger: Logger, streamingEnabled: boolean);
    /** 追加文本增量 */
    append(text: string): void;
    /** 获取当前累积文本 */
    get text(): string;
    /** 发送所有累积文本：流式优先，降级静态 */
    flush(): Promise<void>;
    /** 取消（异常/丢弃），中止流式并清空缓冲 */
    cancel(): void;
}
//# sourceMappingURL=outbound-buffer.d.ts.map