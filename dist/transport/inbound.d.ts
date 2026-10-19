import type { SessionManager } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
/**
 * 处理 QQ 入站消息（已经过 SDK 中间件链）
 */
export declare function handleInbound(ctx: MiddlewareContext, manager: SessionManager, config: ImQQBotConfig, logger: Logger): Promise<void>;
//# sourceMappingURL=inbound.d.ts.map