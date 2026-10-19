/**
 * PrefsStore — per-peer 会话偏好持久化（模型 + preset）
 *
 * 隔离文件 I/O 操作，便于单元测试时 mock。
 * 存储路径：~/.dsh-qqbot/model-prefs.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
export class PrefsStore {
    /** per-peer 模型偏好（内存态） */
    overrides = new Map();
    /** per-peer 最新 sessionId（fork 后更新，内存态） */
    sessionIds = new Map();
    /** per-peer preset 偏好（内存态） */
    presets = new Map();
    /** 隔离偏好文件路径 */
    prefsPath;
    debugLog;
    constructor(debugLog) {
        this.prefsPath = resolve(homedir(), '.dsh-qqbot', 'model-prefs.json');
        this.debugLog = debugLog;
        this.load();
    }
    // ── Override 操作 ──
    getOverride(sessionKey) {
        return this.overrides.get(sessionKey);
    }
    setOverride(sessionKey, route) {
        this.overrides.set(sessionKey, route);
        this.write();
    }
    clearOverride(sessionKey) {
        const deleted = this.overrides.delete(sessionKey);
        if (deleted)
            this.write();
        return deleted;
    }
    hasOverride(sessionKey) {
        return this.overrides.has(sessionKey);
    }
    // ── SessionId 操作 ──
    getSessionId(sessionKey) {
        return this.sessionIds.get(sessionKey);
    }
    setSessionId(sessionKey, sessionId) {
        this.sessionIds.set(sessionKey, sessionId);
        this.write();
    }
    clearSessionId(sessionKey) {
        const deleted = this.sessionIds.delete(sessionKey);
        if (deleted)
            this.write();
        return deleted;
    }
    // ── Preset 操作 ──
    getPreset(sessionKey) {
        return this.presets.get(sessionKey);
    }
    setPreset(sessionKey, presetId) {
        this.presets.set(sessionKey, presetId);
        this.write();
    }
    clearPreset(sessionKey) {
        const deleted = this.presets.delete(sessionKey);
        if (deleted)
            this.write();
        return deleted;
    }
    // ── 私有方法 ──
    load() {
        try {
            if (!existsSync(this.prefsPath))
                return;
            const content = readFileSync(this.prefsPath, 'utf8');
            const data = JSON.parse(content);
            if (data.overrides && typeof data.overrides === 'object') {
                for (const [key, route] of Object.entries(data.overrides)) {
                    if (route.provider && route.model) {
                        this.overrides.set(key, { provider: route.provider, model: route.model });
                    }
                }
            }
            if (data.sessionIds && typeof data.sessionIds === 'object') {
                for (const [key, sessionId] of Object.entries(data.sessionIds)) {
                    if (typeof sessionId === 'string' && sessionId) {
                        this.sessionIds.set(key, sessionId);
                    }
                }
            }
            if (data.presets && typeof data.presets === 'object') {
                for (const [key, presetId] of Object.entries(data.presets)) {
                    if (typeof presetId === 'string' && presetId) {
                        this.presets.set(key, presetId);
                    }
                }
            }
        }
        catch (err) {
            this.debugLog?.(`loadPrefs failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    write() {
        try {
            mkdirSync(dirname(this.prefsPath), { recursive: true });
            const data = {
                overrides: Object.fromEntries(this.overrides.entries()),
                sessionIds: Object.fromEntries(this.sessionIds.entries()),
                presets: Object.fromEntries(this.presets.entries()),
            };
            writeFileSync(this.prefsPath, JSON.stringify(data, null, 2), 'utf8');
        }
        catch (err) {
            this.debugLog?.(`writePrefs failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
//# sourceMappingURL=prefs-store.js.map