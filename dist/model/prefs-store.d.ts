import type { ModelRoute } from './types.ts';
/** 日志回调（可选） */
type DebugFn = (msg: string) => void;
export declare class PrefsStore {
    /** per-peer 模型偏好（内存态） */
    private overrides;
    /** per-peer 最新 sessionId（fork 后更新，内存态） */
    private sessionIds;
    /** per-peer preset 偏好（内存态） */
    private presets;
    /** 隔离偏好文件路径 */
    private readonly prefsPath;
    private readonly debugLog?;
    constructor(debugLog?: DebugFn);
    getOverride(sessionKey: string): ModelRoute | undefined;
    setOverride(sessionKey: string, route: ModelRoute): void;
    clearOverride(sessionKey: string): boolean;
    hasOverride(sessionKey: string): boolean;
    getSessionId(sessionKey: string): string | undefined;
    setSessionId(sessionKey: string, sessionId: string): void;
    clearSessionId(sessionKey: string): boolean;
    getPreset(sessionKey: string): string | undefined;
    setPreset(sessionKey: string, presetId: string): void;
    clearPreset(sessionKey: string): boolean;
    private load;
    private write;
}
export {};
//# sourceMappingURL=prefs-store.d.ts.map