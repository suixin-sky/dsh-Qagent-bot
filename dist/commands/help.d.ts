/**
 * /bot-help — 查看所有指令，按「通用能力 / QQ 机器人特有」分组展示
 *
 * 通用能力：对应底层 dsh agent 能力（new/compact/model/stop），无前缀
 * QQBot 特有：插件自身封装（bot-ping/bot-version/bot-status/bot-help），带 bot- 前缀
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
/** /bot-help — 分组查看所有指令 */
export declare function helpCommand({ config }: CommandDeps, allCommands: () => CategorizedCommand[]): CategorizedCommand;
//# sourceMappingURL=help.d.ts.map