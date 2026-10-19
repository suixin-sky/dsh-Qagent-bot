import type { Logger, RawAttachment } from '../types.ts';
import type { MediaConfig } from '../config.ts';
/** 下载结果 */
export interface DownloadedFile {
    /** 原始文件名（用于与消息附件关联） */
    filename: string;
    /** 附件类型 */
    contentType: 'image' | 'video' | 'file';
    /** 本地绝对路径 */
    localPath: string;
}
/** 附件归类（QQ 网关的 content_type 是 MIME 类型，如 image/png、video/mp4、audio/silk） */
export type MediaKind = 'image' | 'video' | 'voice' | 'file';
/** 是否为图片（兼容裸值 'image' 与 MIME 'image/png'） */
export declare function isImageContentType(contentType?: string): boolean;
/** 是否为视频（兼容裸值 'video' 与 MIME 'video/mp4'） */
export declare function isVideoContentType(contentType?: string): boolean;
/** 是否为语音（兼容裸值 'voice' 与 MIME 'audio/silk'） */
export declare function isVoiceContentType(contentType?: string): boolean;
/** 归类附件 content_type 为统一类型 */
export declare function classifyContentType(contentType?: string): MediaKind;
/**
 * 下载消息中的富媒体附件（image/video/file）到本地
 *
 * 下载目录固定为 ~/.dsh-qqbot/media，文件名用时间戳+随机数防重名。
 * 下载失败不阻断（由调用方回退描述）。
 */
export declare function downloadMediaAttachments(attachments: RawAttachment[] | undefined, media: MediaConfig, logger: Logger): Promise<DownloadedFile[]>;
//# sourceMappingURL=attachment.d.ts.map