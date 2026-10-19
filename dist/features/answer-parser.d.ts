/**
 * QQ 文本回复 → 结构化答案（纯函数，便于单测）。
 *
 * 逐题解析：一次解析一个问题的答案。
 */
import type { UserQuestion, UserQuestionAnswer } from './question-channel.ts';
/** 把用户对单个问题的文本回复解析为答案 */
export declare function parseAnswer(question: UserQuestion, text: string): UserQuestionAnswer;
//# sourceMappingURL=answer-parser.d.ts.map