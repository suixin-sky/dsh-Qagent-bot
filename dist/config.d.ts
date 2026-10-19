/**
 * dsh-im-qqbot 插件配置 Schema
 */
import Schema from '@deepseek-ai/schemastery';
export interface AccessControlConfig {
    /** C2C 访问模式 */
    c2cMode: 'open' | 'allowlist' | 'disabled';
    /** C2C 白名单（user openid） */
    c2cAllow: string[];
    /** 群聊访问模式 */
    groupMode: 'open' | 'allowlist' | 'disabled';
    /** 群聊白名单（group openid） */
    groupAllow: string[];
}
export interface MediaConfig {
    /** 是否启用富媒体理解（图片/视频下载 + 工具分析） */
    enabled: boolean;
    /** 富媒体下载大小上限（MB），默认 200 */
    maxMB: number;
    /** 富媒体存活时长（小时，TTL），默认 24，0 = 永不过期 */
    ttlHours: number;
}
export interface VisionConfig {
    /** 是否启用视觉理解（qqbot_describe_image 工具） */
    enabled: boolean;
    /** 视觉模型 provider（dsh 注册的 llm adapter，如 pi-ai） */
    provider: string;
    /** 视觉模型 id（如 qwen-vl-max） */
    model: string;
    /** 默认描述 prompt（调用未显式指定时使用） */
    defaultPrompt: string;
    /** 图片字节上限，默认 10MB */
    maxBytes: number;
    /** 输出 token 上限 */
    maxTokens: number;
    /** 视觉调用超时(ms) */
    timeoutMs: number;
}
export interface SendFileConfig {
    /** 是否启用路径白名单（默认 true，仅允许 media + cwd + extraRoots；关闭则任意路径） */
    restrictPaths: boolean;
    /** 额外允许访问的根目录（media 和 agent cwd 始终默认允许） */
    extraRoots: string[];
}
export interface SummonConfig {
    /** 是否启用自然语言召唤本地模型 */
    enabled: boolean;
    /** 机器人称呼词（`|` 分隔，仅用于投递预筛） */
    addresses: string;
    /** 动作词（`|` 分隔，仅用于投递预筛） */
    cues: string;
    /** 群聊里消息以机器人称呼开头时免 @ 直接回复 */
    callByName: boolean;
    /** 裁判模型 provider（留空=宿主默认） */
    judgeProvider: string;
    /** 裁判模型 id（留空=宿主默认） */
    judgeModel: string;
    /** 裁判调用超时(ms) */
    judgeTimeoutMs: number;
    /** 本地模型目标 */
    local: {
        /** 本地模型 provider */
        provider: string;
        /** 本地模型 id（留空=自动挑该 provider 下第一个 qwen） */
        model: string;
        /** 本地模型叫法（`|` 分隔） */
        names: string;
    };
    /** 宿主默认模型目标 */
    host: {
        /** 默认模型叫法（`|` 分隔） */
        names: string;
    };
    /** 切到本地前探测的服务地址（留空则跳过） */
    healthUrl: string;
    /** 闲置多久后自动切回默认模型(ms) */
    idleRevertMs: number;
    /** 回流 provider（留空用宿主默认） */
    revertProvider: string;
    /** 回流模型 id（留空用宿主默认） */
    revertModel: string;
    /** 回流后的推理等级 */
    revertReasoningEffort: string;
}
export interface ImQQBotConfig {
    /** QQ Bot AppID */
    appId: string;
    /** QQ Bot AppSecret */
    appSecret: string;
    /** dsh LLM 提供商名称 */
    provider?: string;
    /** 模型名称 */
    model?: string;
    /** Agent preset id */
    preset?: string;
    /** Agent 工作目录（缺省回落到进程 cwd） */
    cwd?: string;
    /** 是否启用群消息 @mention 门控 */
    requireMention: boolean;
    /** 群聊额外 system prompt */
    groupPrompt?: string;
    /** 私聊额外 system prompt */
    directPrompt?: string;
    /** 单条消息最大长度（QQ 限制约 5000 字符） */
    textChunkLimit: number;
    /** 是否启用流式输出（群聊始终不启用） */
    streaming: boolean;
    /** 每会话最大闲置时长(ms)，超时自动回收 */
    sessionIdleTimeout: number;
    /** 并发队列最大长度 */
    maxQueue: number;
    /** 处理超时(ms)，超时中断当前 LLM 调用 */
    processingTimeoutMs: number;
    /** 待答问题超时(ms)，超时自动拒绝并提示（ask_user_question） */
    askTimeoutMs: number;
    /** 群历史缓冲条数 */
    historyLimit: number;
    /** 访问控制 */
    access: AccessControlConfig;
    /** 是否展示工具调用成功结果（工具错误始终展示） */
    showToolResults: boolean;
    /** 调试模式 */
    debug: boolean;
    /** 富媒体理解（图片/视频） */
    media: MediaConfig;
    /** 视觉理解（qqbot_describe_image 工具，走 dsh llm + attachments） */
    vision: VisionConfig;
    /** 附件发送（qqbot_send_file 工具） */
    sendFile: SendFileConfig;
    /** 千金大小姐：自然语言召唤本地模型 */
    summon: SummonConfig;
    /** 聊天归档 */
    archive: ArchiveConfig;
    /** 默认人设提示词文件（.txt/.md） */
    personaFile: string;
    /** 按模型路由指定人设（优先于 personaFile） */
    personas: PersonaRule[];
    /** 表情包 */
    sticker: StickerConfig;
    /** 对话延续判定 */
    continuation: ContinuationConfig;
    /** 安全门控 */
    security: SecurityConfig;
    /** ComfyUI 视频/图片生成 */
    comfyui: ComfyUIConfig;
}
export interface SecurityConfig {
    /** 路径安全门控开关 */
    enabled: boolean;
    /** 工作区根目录（归档、表情包、工作流都应在它下面） */
    workspace: string;
    /** DSH 安装目录（留空则不加入白名单） */
    dshRoot: string;
    /** 额外允许的根目录 */
    extraRoots: string[];
}
export interface ComfyUIConfig {
    /** 是否启用 ComfyUI 生成工具 */
    enabled: boolean;
    /** ComfyUI 地址 */
    baseUrl: string;
    /** 视频工作流 JSON 路径（必须位于工作区） */
    workflow: string;
    /** 图片工作流 JSON 路径（必须位于工作区） */
    imageWorkflow: string;
    /** 临时产物目录（发送后删除） */
    outputDir: string;
    /** 默认时长(秒) */
    defaultSeconds: number;
    /** 最大时长(秒) */
    maxSeconds: number;
    /** 默认画质 0-1 */
    defaultQuality: number;
    /** 画质上限 */
    maxQuality: number;
    /** 视频生成超时(ms) */
    timeoutMs: number;
    /** 图片生成超时(ms) */
    imageTimeoutMs: number;
    /** 生成完成后 @ 发起人 */
    mentionSender: boolean;
}
export interface ContinuationConfig {
    /** 机器人刚说完话后，自动判断后续群消息是否在跟它说话/笑它 */
    enabled: boolean;
    /** 判定窗口(ms)：机器人最后一条消息之后多久内生效 */
    windowMs: number;
    /** 裁判模型 provider（留空=宿主默认） */
    judgeProvider: string;
    /** 裁判模型 id（留空=宿主默认） */
    judgeModel: string;
    /** 裁判调用超时(ms) */
    judgeTimeoutMs: number;
}
export interface PersonaRule {
    /** provider/model、provider/* 或 * */
    match: string;
    /** 人设文件路径 */
    file: string;
}
export interface StickerConfig {
    /** 是否启用表情包工具 */
    enabled: boolean;
    /** 表情包目录（子目录名=标签；留空=~/.dsh-qqbot/stickers） */
    dir: string;
    /** 是否在系统提示里告诉模型表情包工具与标签 */
    promptHint: boolean;
}
export interface ArchiveConfig {
    /** 是否把聊天记录归档成 Markdown */
    enabled: boolean;
    /** 归档根目录（留空 = ~/.dsh-qqbot/chatlog） */
    dir: string;
    /** 是否保存图片/视频/文件附件到归档目录 */
    images: boolean;
    /** 是否在系统提示里告诉模型可以用 qqbot_chat_log 查归档 */
    promptHint: boolean;
    /** 文本记录保留天数（0=永久） */
    textKeepDays: number;
    /** 图片/视频保留天数（0=永久） */
    mediaKeepDays: number;
}
/** 访问控制子 Schema（独立导出：config 路由的服务端校验复用） */
export declare const AccessControlSchema: Schema<AccessControlConfig>;
export declare const ConfigSchema: Schema<ImQQBotConfig>;
//# sourceMappingURL=config.d.ts.map