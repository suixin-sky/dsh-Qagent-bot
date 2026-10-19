/**
 * 群历史存储共享模块
 *
 * historyBuffer 中间件需要一个跨调用可访问的 HistoryStore 实例，
 * 以便在回复完成后清空某群的历史缓存（避免下次 @ 时重复组包）。
 */
import { MemoryHistoryStore } from '@tencent-connect/qqbot-nodejs';
let _store = null;
/** 获取共享历史存储（单例） */
export function getHistoryStore() {
    if (!_store)
        _store = new MemoryHistoryStore();
    return _store;
}
/** 用 appId 前缀隔离群历史（单账号下等价于 groupOpenid，保留多账号扩展） */
export function historyGroupKey(appId, groupId) {
    return `${appId}:${groupId}`;
}
/** 清空群历史（回复后调用，避免下次 @ 时重复组包） */
export function clearGroupHistory(appId, groupId) {
    _store?.clear?.(historyGroupKey(appId, groupId));
}
//# sourceMappingURL=history-store.js.map