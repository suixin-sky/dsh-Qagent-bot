import { decodeButtonData } from "./button-utils.js";
import { buildApprovalKeyboard, buildApprovalText } from "./approval-renderer.js";
const COMMAND_CLIP = 500;
/**
 * 从 session log 按 callId 找回被 gate 的命令（审批请求本身不重复携带 arguments）。
 * 对齐 TUI/web 的 `commandOf` 语义。
 */
function commandOf(req) {
    if (req.callId === undefined)
        return undefined;
    const events = req.agent.session.events;
    for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (!event || event.type !== 'tool/call')
            continue;
        const data = event.data;
        if (String(data?.callId) !== String(req.callId))
            continue;
        const raw = data?.arguments;
        if (typeof raw !== 'string')
            return undefined;
        try {
            const parsed = JSON.parse(raw);
            if (parsed !== null && typeof parsed === 'object' && 'command' in parsed) {
                const command = parsed.command;
                if (typeof command === 'string')
                    return command;
            }
        }
        catch {
            // 非 JSON，回退到原始字符串
        }
        return raw.length <= COMMAND_CLIP ? raw : `${raw.slice(0, COMMAND_CLIP)}…`;
    }
    return undefined;
}
export class ApprovalChannel {
    pending = new Map();
    manager;
    sender;
    logger;
    constructor(manager, sender, logger) {
        this.manager = manager;
        this.sender = sender;
        this.logger = logger;
    }
    /**
     * 注册 approval/request waterfall answerer。approval 服务未挂载时优雅禁用。
     */
    install(ctx) {
        let hasApproval = false;
        try {
            hasApproval = ctx.get('approval') !== undefined;
        }
        catch {
            hasApproval = false;
        }
        if (!hasApproval) {
            this.logger.debug('im-qqbot: approval service unavailable — approval channel disabled');
            return;
        }
        const self = this;
        ctx.on('approval/request', (req, next) => {
            const request = req;
            const nextFn = next;
            const record = self.manager.findBySessionId(request.agent.id);
            if (record)
                return self.park(record, request);
            return nextFn();
        }, { prepend: true });
        this.logger.info('im-qqbot: QQ approval channel installed');
    }
    /** 会话回收时清理其 pending 审批，避免 Promise 悬挂 */
    cancelPending(sessionKey) {
        const entry = this.pending.get(sessionKey);
        if (!entry)
            return;
        this.pending.delete(sessionKey);
        this.removeAbort(entry);
        entry.resolve('cancelled');
    }
    /** 按钮点击决策：解码 button_data，settle pending 审批 */
    handleInteraction(event) {
        const peerId = event.group_openid ?? event.user_openid;
        if (!peerId)
            return false;
        const scope = event.group_openid ? 'group' : 'c2c';
        const record = this.manager.getSessionRecord(scope, peerId);
        if (!record)
            return false;
        const entry = this.pending.get(record.sessionKey);
        if (!entry)
            return false;
        const data = event.data?.resolved?.button_data;
        if (!data)
            return false;
        const button = decodeButtonData(data);
        if (!button || button.t !== 'approval')
            return false;
        this.pending.delete(record.sessionKey);
        this.removeAbort(entry);
        entry.resolve(button.d === 'allow' ? 'allowed-once' : 'rejected');
        return true;
    }
    /** 走 QQ 通道：发审批消息 + 挂起 Promise，等待用户决策 */
    async park(record, request) {
        const key = record.sessionKey;
        // 会话回收/取消可能在发送前发生：signal 已 abort 则直接失败
        if (request.signal?.aborted)
            return 'cancelled';
        const command = commandOf(request);
        try {
            await this.sender.sendMarkdown(record.replyTarget, buildApprovalText(request, command), { keyboard: buildApprovalKeyboard() });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`im-qqbot: approval send failed key=${key}: ${msg}`);
            return 'unavailable'; // 无法呈现审批，fail-closed
        }
        return new Promise((resolve) => {
            const entry = { record, request, resolve };
            if (request.signal) {
                const onAbort = () => {
                    if (this.pending.get(key) !== entry)
                        return;
                    this.pending.delete(key);
                    resolve('cancelled');
                };
                entry.onAbort = onAbort;
                request.signal.addEventListener('abort', onAbort, { once: true });
            }
            this.pending.set(key, entry);
            this.logger.info(`im-qqbot: approval sent to QQ, waiting for decision key=${key}`);
        });
    }
    removeAbort(entry) {
        if (entry.onAbort && entry.request.signal) {
            entry.request.signal.removeEventListener('abort', entry.onAbort);
        }
    }
}
//# sourceMappingURL=approval-channel.js.map