import type { Context } from '@deepseek-ai/cordis';
import type { ImQQBotConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger, ReplyTarget } from '../types.ts';
/** 工具名（qqbot 前缀避免与其他通道的同名工具冲突） */
export declare const SEND_FILE_TOOL_NAME = "qqbot_send_file";
/** 发送器最小接口（QQBot 实例满足） */
interface MediaSendResult {
    upload: {
        file_uuid: string;
    };
    message?: {
        id?: string;
    };
}
export interface MediaSenderLike {
    sendImage(target: ReplyTarget, source: {
        localPath?: string;
    }): Promise<MediaSendResult>;
    sendVideo(target: ReplyTarget, source: {
        localPath?: string;
    }): Promise<MediaSendResult>;
    sendVoice(target: ReplyTarget, source: {
        localPath?: string;
    }): Promise<MediaSendResult>;
    sendFile(target: ReplyTarget, source: {
        localPath?: string;
    }, opts?: {
        fileName?: string;
    }): Promise<MediaSendResult>;
}
/** 注册 qqbot_send_file 工具（tools 服务缺失时优雅降级，不阻断插件启动） */
export declare function registerSendFileTool(ctx: Context, bot: MediaSenderLike, manager: SessionManager, config: ImQQBotConfig, logger: Logger): void;
export {};
//# sourceMappingURL=send-file-tool.d.ts.map