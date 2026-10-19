/**
 * QQ 审批的文本渲染与按钮键盘构建（纯函数，便于单测）。
 *
 * 单次审批：一次只渲染一个审批请求（每个会话同时只有一个 pending 审批）。
 */
import type { InlineKeyboard } from '@tencent-connect/qqbot-nodejs';
import type { ApprovalRequest } from './approval-channel.ts';
/** 把审批请求渲染成 QQ 文本（含被 gate 的命令回显） */
export declare function buildApprovalText(request: ApprovalRequest, command?: string): string;
/**
 * 构建审批键盘：两按钮（允许一次 / 拒绝）。
 *
 * dsh 审批协议 outcome 是闭合集合（allowed-once/rejected/cancelled/unavailable），
 * 无 allow-always，因此只提供两个按钮；`group_id` 相同实现单选互斥变灰。
 * button_data 编码 `{"t":"approval","d":"allow"|"deny"}`，由分发器解码。
 */
export declare function buildApprovalKeyboard(): InlineKeyboard;
//# sourceMappingURL=approval-renderer.d.ts.map