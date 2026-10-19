/**
 * 端内绑定页路由 — /qqbot/im-qqbot/bind
 *
 * 注册在 dsh-host-webserver（ctx.webServer）的具名路由：
 * - Web 模式：页面同源直接访问
 * - Desktop：渲染进程的 fetch 经 IPC 桥自动附加 Host 认证转发
 *
 * 响应只含 task 级短时效数据（二维码 URL/SVG）与脱敏的 appId；
 * appSecret 绝不出现在任何响应中。manual 提交走与扫码一致的
 * persist 路径（写入 profile patch → HMR 重载生效）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../types.ts';
import type { BindingService } from './binding-service.ts';
import { type SetupCredentials } from './persist.ts';
import { BIND_CONFIG_PATH, BIND_MANUAL_PATH, BIND_REFRESH_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH, type BindStateWire } from '../shared/bind-protocol.ts';
export { BIND_CONFIG_PATH, BIND_MANUAL_PATH, BIND_REFRESH_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH };
export type { BindStateWire };
/** dsh-host-webserver 的具名路由注册形状（局部投影，避免硬依赖） */
export interface WebRoute {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
/** ctx.webServer 的局部投影（服务可用性由调用方探测） */
export interface WebServerLike {
    register(route: WebRoute): () => void;
}
/** 手动凭据提交的处理结果 */
export interface ManualSubmitResult {
    /** 是否已持久化（false = 落盘失败，需展示手动配置指引） */
    persisted: boolean;
    /** 失败原因（persisted=false 时回传给表单展示） */
    error?: string;
}
/** 解绑处理结果 */
export interface UnbindResult {
    persisted: boolean;
    error?: string;
}
/** 路由行为注入 */
export interface BindRoutesOptions {
    /**
     * 已绑定态：返回脱敏的 appId（可回显，非机密），null 表示未绑定。
     * 已绑定 fiber 注册路由时提供；待绑定流程不提供。
     */
    boundAppId?: () => string | null;
    /**
     * 手动凭据提交处理（默认：persist 到 profile patch）。
     * 待绑定流程会注入「先终止扫码轮询」的包装。
     */
    onManualCredentials?: (credentials: SetupCredentials) => ManualSubmitResult;
    /**
     * 解绑处理（默认：移除 profile patch 中的凭据字段）。
     * 未绑定态调用返回 409，不触达本回调。
     */
    onUnbind?: () => UnbindResult;
    /**
     * 当前生效配置（apply 时 loader 合并后的值，含默认值填充），
     * 用于 GET 回显（appSecret 剔除后返回）。
     */
    currentConfig?: () => Record<string, unknown>;
    /**
     * 配置写入处理（默认：最小合并写入 profile patch）。
     */
    onUpdateConfig?: (config: Record<string, unknown>) => boolean;
}
/**
 * 注册绑定路由（状态查询 / 刷新二维码 / 手动凭据）。
 *
 * @param webServer - ctx.webServer
 * @param service - 绑定状态机；已绑定 fiber 传 null（无扫码流程）
 * @param logger - 日志
 * @param options - 行为注入（bound 态回显、manual 处理）
 * @returns 注销函数（与插件 fiber 生命周期绑定）
 */
export declare function registerBindRoutes(webServer: WebServerLike, service: BindingService | null, logger: Logger, options?: BindRoutesOptions): () => void;
//# sourceMappingURL=bind-routes.d.ts.map