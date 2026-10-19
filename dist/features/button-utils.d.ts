/**
 * 按钮渲染与 button_data 编码的共享工具（QuestionChannel / ApprovalChannel 共用）。
 *
 * 统一 button_data 编码：所有回调按钮的 data 都带顶层 `t` 判别字段，
 * 供 `dispatchInteraction` 分发器统一路由到对应 channel，避免多通道
 * 各自 try 导致误判。
 */
import type { InlineKeyboard } from '@tencent-connect/qqbot-nodejs';
/** QQ 按钮 label 有长度限制，超长截断（正文保留完整文本；多列布局下阈值更短） */
export declare const BUTTON_LABEL_MAX = 10;
/** 单选按钮每行个数（多列布局，减少选项多时的刷屏） */
export declare const BUTTONS_PER_ROW = 2;
/** 截断按钮 label，超长补省略号 */
export declare function buttonLabel(text: string | undefined): string;
/** 问答按钮：q=问题 id，i=选项下标 */
export interface QuestionButtonData {
    t: 'question';
    q: string;
    i: number;
}
/** 审批按钮：d=决策 */
export interface ApprovalButtonData {
    t: 'approval';
    d: 'allow' | 'deny';
}
export type ButtonData = QuestionButtonData | ApprovalButtonData;
/** 编码 button_data（JSON 字符串） */
export declare function encodeButtonData(data: ButtonData): string;
/** 解码 button_data；非法 JSON 或缺少合法 `t` 时返回 undefined */
export declare function decodeButtonData(raw: string): ButtonData | undefined;
/** 构建内联键盘的行数组（供 buildKeyboard/buildApprovalKeyboard 复用类型） */
export type KeyboardRows = InlineKeyboard['content']['rows'];
//# sourceMappingURL=button-utils.d.ts.map