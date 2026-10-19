/**
 * 凭据绑定编排 — setup/ 模块入口
 *
 * apply() 检测到凭据缺失时调用 ensureCredentials：
 * 1. 创建 BindingService（单例接管，HMR 双 fiber 安全）
 * 2. Web 宿主（dsh web / Desktop）注册端内绑定页路由
 *    —— 经 ctx.inject(['webServer'], ...) 可选注入：服务未就绪时插件
 *       照常加载（CLI profile），就绪/替换时自动（重）注册路由
 * 3. 按宿主形态挂呈现策略（终端 / 浏览器降级）
 * 4. 生命周期与 ctx fiber 绑定（dispose 时 abort 轮询、注销路由）
 *
 * 凭据已配置的 fiber 调用 registerBoundCredentialRoutes 注册常驻路由
 * （bound 状态回显 + 手动编辑），与扫码流程共用持久化路径。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Logger } from '../types.ts';
import { type SetupCredentials } from './persist.ts';
export type { SetupCredentials } from './persist.ts';
export { persistCredentialsToProfile } from './persist.ts';
export { isDesktopHost } from './presenters.ts';
/** ensureCredentials 参数 */
export interface EnsureCredentialsOptions {
    logger: Logger;
    /** 二维码 URL 的 source 标识 */
    source?: string;
    /** 当前生效配置（apply 时 loader 合并值；config 路由 GET 回显用） */
    config: Record<string, unknown>;
}
/**
 * 执行扫码绑定编排，返回凭据就绪的 Promise；失败/取消 resolve null。
 *
 * 【同步契约】函数体必须保持无 await——绑定编排（服务接管、路由注册、
 * 呈现策略、ctx 生命周期挂载）在调用后的同步阶段全部完成，随后返回
 * `service.start()` 的挂起 Promise。调用方（插件 apply）因此可以不等待
 * 扫码结果直接完成加载：boot 的 `loader.await()` 会等所有插件 fiber
 * settle，若 apply 无限期等待用户扫码，Host ready 会被阻塞
 * （Desktop 界面无法进入、Web URL 延迟输出）。
 *
 * 凭据持久化由调用方在 Promise 的 then 链中执行——成功写入
 * cordis.patch.yml 会触发 HMR 热重载，新 fiber 以凭据启动网关。
 */
export declare function ensureCredentials(ctx: Context, options: EnsureCredentialsOptions): Promise<SetupCredentials | null>;
/**
 * 凭据已配置的 fiber 注册常驻路由（状态回显 + 手动编辑/更换）。
 *
 * 在 apply 的 bootstrapGateway 之前调用；写入经同一 persist 路径，
 * 保存后触发 HMR 重载、新 fiber 以新凭据重启网关。
 */
export declare function registerBoundCredentialRoutes(ctx: Context, logger: Logger, appId: string, config: Record<string, unknown>): void;
//# sourceMappingURL=index.d.ts.map