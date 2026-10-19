/**
 * QQ 问答的文本渲染与按钮键盘构建（纯函数，便于单测）。
 *
 * 逐题渲染：一次只渲染一个问题（多题时由状态机逐题推进）。
 */
import type { InlineKeyboard } from '@tencent-connect/qqbot-nodejs';
import type { UserQuestion } from './question-channel.ts';
/**
 * 为「单选、带选项」的问题构建内联键盘；不适用时返回 undefined。
 *
 * 多行多列布局：每行 BUTTONS_PER_ROW 个按钮，减少选项多时的刷屏。
 *
 * button_data 编码 `{"t":"question","q":<问题id>,"i":<选项下标>}`，由分发器解码。
 * `t` 顶层判别字段供 interaction 统一路由；`q` 关联「当前正在问的题」：逐题
 * 推进时旧题按钮在新题发出后被点击，其 q 不等于当前题 id，可被识别并忽略。
 */
export declare function buildKeyboard(question: UserQuestion): InlineKeyboard | undefined;
/** 把单个问题渲染成 QQ 文本 */
export declare function formatQuestion(question: UserQuestion, requireMentionHint: boolean, withButtons: boolean): string;
//# sourceMappingURL=question-renderer.d.ts.map