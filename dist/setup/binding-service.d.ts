import type { QrConnectCallbacks, QrConnectOptions } from '@tencent-connect/qqbot-connector';
import type { Logger } from '../types.ts';
import type { QrPresenter } from './presenters.ts';
import { renderQrSvgDataUrl } from './qr-svg.ts';
import type { SetupCredentials } from './persist.ts';
/** connector 连接函数签名（可注入便于测试） */
export type ConnectFn = (callbacks: QrConnectCallbacks, options?: QrConnectOptions) => () => void;
/** 绑定状态机相位 */
export type BindPhase = {
    kind: 'idle';
} | {
    kind: 'waiting';
    url: string;
    qrSvg?: string;
    issuedAt: number;
} | {
    kind: 'saving';
} | {
    kind: 'failed';
    reason: string;
};
/** HTTP 路由序列化形态（线上协议，供端内绑定页消费） */
export type BindStateWire = {
    phase: 'starting';
} | {
    phase: 'waiting';
    url: string;
    qrSvg?: string;
    issuedAt: number;
} | {
    phase: 'saving';
} | {
    phase: 'failed';
    reason: string;
};
/** 构造参数 */
export interface BindingServiceOptions {
    /** 调用来源标识，拼入二维码 URL */
    source: string;
    logger: Logger;
    /** connector 注入点（默认真实实现） */
    connect?: ConnectFn;
    /** 二维码渲染注入点（默认真实实现） */
    renderQr?: typeof renderQrSvgDataUrl;
}
/**
 * 单个绑定会话的状态机。
 *
 * start() 幂等；refresh() 通过 abort 当前 connectOnce 使 run 循环
 * 重建绑定任务（新二维码）；dispose() 终止一切轮询。
 */
export declare class BindingService {
    private phase;
    private readonly listeners;
    private readonly presenters;
    private readonly connectFn;
    private readonly renderQrFn;
    private readonly source;
    private readonly logger;
    private readonly lifetime;
    private refreshCtl;
    private runId;
    private startPromise;
    private disposed;
    constructor(options: BindingServiceOptions);
    /** 当前相位（路由轮询读取） */
    get currentPhase(): BindPhase;
    /** 状态订阅（预留给 SSE 推送等增强） */
    subscribe(listener: () => void): () => void;
    /** 挂载呈现策略（须在 start() 前调用） */
    attach(presenter: QrPresenter): void;
    /** 序列化为线上协议 */
    wireState(): BindStateWire;
    /** 启动绑定流程（幂等） */
    start(): Promise<SetupCredentials | null>;
    /** 用户请求刷新：废弃当前二维码任务，run 循环会重建 */
    refresh(): void;
    /** 终止绑定（插件卸载 / HMR 接管 / 替换） */
    dispose(): void;
    private run;
    private connectOnce;
    private handleQrDisplayed;
    private handleQrExpired;
    private setPhase;
}
//# sourceMappingURL=binding-service.d.ts.map