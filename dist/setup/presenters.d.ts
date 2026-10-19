import type { Logger } from '../types.ts';
/** 呈现策略接口：二维码事件的通知接收方 */
export interface QrPresenter {
    /** 实现标识（诊断用） */
    readonly id: string;
    /** 是否让 connector 在控制台打印 ASCII 二维码（仅终端可见的宿主开启） */
    readonly printQrToConsole: boolean;
    /** 二维码 URL 就绪（首次与过期刷新均会触发） */
    onQrDisplayed(url: string): void;
    /** 二维码过期，即将刷新 */
    onQrExpired?(): void;
}
/**
 * 是否运行在 DSH Desktop 宿主中。
 *
 * Desktop 的 Host 以 ELECTRON_RUN_AS_NODE=1 的 Electron 子进程运行
 * （Desktop 宿主的启动约定），stdout 对用户不可见，终端呈现无意义。
 */
export declare function isDesktopHost(): boolean;
/** 终端可点击的 OSC 8 超链接（不支持 OSC 8 的终端会忽略控制序列，退化为纯 URL 文本） */
export declare function clickableLink(url: string): string;
/**
 * 终端呈现（CLI / `dsh web` 运营者通道）
 *
 * ASCII 二维码由 connector 打印（printQrToConsole=true），
 * 本呈现只补打可点击链接与过期提示。
 *
 * 绑定引导是用户直接交互内容，必须用普通 console.log 输出：
 * 不带时间戳/级别前缀（避免打断二维码块），不受日志级别配置影响。
 */
export declare function createTerminalPresenter(): QrPresenter;
/**
 * 系统浏览器呈现（降级通道）
 *
 * Desktop 端内绑定页不可用时的自救入口：每次绑定会话只自动拉起一次
 * 浏览器（二维码过期刷新不重复弹窗）。默认关闭，通过环境变量
 * QQBOT_BIND_OPEN_BROWSER=1 显式启用。
 */
export declare function createBrowserPresenter(logger: Logger): QrPresenter;
//# sourceMappingURL=presenters.d.ts.map