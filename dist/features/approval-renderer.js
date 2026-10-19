import { encodeButtonData } from "./button-utils.js";
/** 把审批请求渲染成 QQ 文本（含被 gate 的命令回显） */
export function buildApprovalText(request, command) {
    const lines = ['🔐 **执行审批**', ''];
    lines.push(`🔧 工具: ${request.toolName}`);
    if (command) {
        lines.push('');
        lines.push('```');
        lines.push(command);
        lines.push('```');
    }
    if (request.reason) {
        lines.push('');
        lines.push(`📝 ${request.reason}`);
    }
    lines.push('');
    lines.push('> 👇 点击下方按钮确认是否允许执行');
    return lines.join('\n');
}
/**
 * 构建审批键盘：两按钮（允许一次 / 拒绝）。
 *
 * dsh 审批协议 outcome 是闭合集合（allowed-once/rejected/cancelled/unavailable），
 * 无 allow-always，因此只提供两个按钮；`group_id` 相同实现单选互斥变灰。
 * button_data 编码 `{"t":"approval","d":"allow"|"deny"}`，由分发器解码。
 */
export function buildApprovalKeyboard() {
    const allow = {
        id: 'approval-allow',
        render_data: { label: '✅ 允许一次', visited_label: '✓ 已允许', style: 1 },
        action: {
            type: 1,
            permission: { type: 2 },
            click_limit: 1,
            data: encodeButtonData({ t: 'approval', d: 'allow' }),
        },
        group_id: 'approval',
    };
    const deny = {
        id: 'approval-deny',
        render_data: { label: '❌ 拒绝', visited_label: '✓ 已拒绝', style: 0 },
        action: {
            type: 1,
            permission: { type: 2 },
            click_limit: 1,
            data: encodeButtonData({ t: 'approval', d: 'deny' }),
        },
        group_id: 'approval',
    };
    return { content: { rows: [{ buttons: [allow, deny] }] } };
}
//# sourceMappingURL=approval-renderer.js.map