/**
 * dsh-im-qqbot — QQ Bot IM channel plugin for deepseek-harness
 *
 * Cordis 插件入口。将 QQ 消息平台作为 dsh 的前端协议驱动。
 * 网关组装（中间件编排 + 事件 + 出站 + 生命周期）见 src/gateway/；
 * 凭据绑定编排（扫码状态机 + 端内绑定页路由）见 src/setup/。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ImQQBotConfig } from './config.ts';
export declare const name = "im-qqbot";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<ImQQBotConfig>;
export type { ImQQBotConfig } from './config.ts';
export declare function apply(ctx: Context, config: ImQQBotConfig): Promise<void>;
//# sourceMappingURL=index.d.ts.map