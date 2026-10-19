/** 插件版本号（从 package.json 读取，供 help/version 等展示真实版本） */
export declare const PLUGIN_VERSION: string;
/**
 * 构造 User-Agent 头
 *
 * 格式: dsh-qqbot/{version} (Node/{nodeVersion}; {platform})
 */
export declare function buildUserAgent(): string;
/**
 * 从插件安装路径推导 profile 目录
 *
 * 主策略：逐级向上探测 profile 标志文件（cordis.patch.yml / pnpm-workspace.yaml）。
 * Desktop profile 使用 pnpm workspace 布局（profiles/desktop/dependencies/
 * node_modules/.pnpm/<pkg>/node_modules/...），插件嵌套于多级 node_modules，
 * 仅按 node_modules 匹配会命中内层目录而返回错误位置。
 *
 * 兜底：无标志文件时沿用旧启发式（名为 node_modules 的目录的父目录），
 * 覆盖 CLI profile 的浅层 npm 布局与未写入过 patch 的全新 profile。
 *
 * @param baseDir - 起始目录，缺省为插件根（可注入便于测试）
 */
export declare function getProfileDir(baseDir?: string): string | null;
/**
 * 解析环境变量占位配置
 */
export declare function resolveEnv(configValue: string, envKey: string): string;
/**
 * 格式化相对时间
 */
export declare function formatRelativeTime(ts?: number): string;
//# sourceMappingURL=utils.d.ts.map