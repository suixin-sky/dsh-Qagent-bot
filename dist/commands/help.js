import { sendMarkdownChunked, PLUGIN_VERSION } from "../shared/index.js";
/** /bot-help — 分组查看所有指令 */
export function helpCommand({ config }, allCommands) {
    return {
        name: 'bot-help',
        category: 'qqbot',
        description: '查看所有指令',
        handler: async (cmdCtx) => {
            const agentCmds = [];
            const qqbotCmds = [];
            for (const cmd of allCommands()) {
                if (cmd.hidden)
                    continue;
                (cmd.category === 'agent' ? agentCmds : qqbotCmds).push(cmd);
            }
            const render = (cmds) => {
                const out = [];
                for (const cmd of cmds) {
                    const name = Array.isArray(cmd.name) ? cmd.name[0] : cmd.name;
                    out.push(`<qqbot-cmd-input text="/${name}" show="/${name}"/> ${cmd.description ?? ''}`);
                }
                return out;
            };
            const lines = ['### 🤖 QQ 机器人指令', ''];
            if (agentCmds.length > 0) {
                lines.push('**通用能力**', '', ...render(agentCmds), '');
            }
            if (qqbotCmds.length > 0) {
                lines.push('**插件内置指令**', '', ...render(qqbotCmds), '');
            }
            lines.push('', `> dsh-qqbot v${PLUGIN_VERSION}`);
            await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
            return { kind: 'noop' };
        },
    };
}
//# sourceMappingURL=help.js.map