/**
 * 会话相关命令
 *
 * - /new（别名 /reset /clear）：开始新会话（换新 sessionId）
 * - /compact：原地压缩会话历史（保留 sessionId，摘要替换旧历史）
 *
 * 两者都对应底层 dsh agent 能力，分类为 agent（通用能力）。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
/** /new（别名 /reset /clear）— 开始新会话 */
export declare function newCommand({ manager }: CommandDeps): CategorizedCommand;
/** /compact — 原地压缩会话历史 */
export declare function compactCommand({ manager }: CommandDeps): CategorizedCommand;
//# sourceMappingURL=session.d.ts.map