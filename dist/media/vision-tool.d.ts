import type { Context } from '@deepseek-ai/cordis';
import type { VisionConfig } from '../config.ts';
import type { Logger } from '../types.ts';
/** 工具名（qqbot 前缀避免与外部 describe-image 包的同名工具冲突） */
export declare const DESCRIBE_IMAGE_TOOL_NAME = "qqbot_describe_image";
/**
 * 启动时检查 settings.yaml 里 vision 模型的 input 模态是否声明了 image。
 *
 * 模型配置界面不暴露 `input` 字段，用户通过界面配置的视觉模型默认是纯文本，
 * 会导致 pi-ai adapter 拒绝图片输入。这里在启动时兜底：未声明 image 时自动补 `[text, image]`。
 * 幂等（已声明则跳过），解析/写入失败仅 warn 不阻断启动。
 */
export declare function ensureVisionInputModal(vision: VisionConfig, logger: Logger): void;
/** 注册 qqbot_describe_image 工具（服务缺失时优雅降级，不阻断插件启动） */
export declare function registerDescribeImageTool(ctx: Context, vision: VisionConfig, logger: Logger): void;
//# sourceMappingURL=vision-tool.d.ts.map