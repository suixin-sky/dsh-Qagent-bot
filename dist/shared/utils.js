/**
 * 通用工具函数
 *
 * 纯函数与常量，供插件入口与其他模块复用。
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, '../..');
/** 插件版本号（从 package.json 读取，供 help/version 等展示真实版本） */
export const PLUGIN_VERSION = readPluginVersion();
function readPluginVersion() {
    try {
        const pkgPath = resolve(PLUGIN_ROOT, 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        return pkg.version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/**
 * 构造 User-Agent 头
 *
 * 格式: dsh-qqbot/{version} (Node/{nodeVersion}; {platform})
 */
export function buildUserAgent() {
    return `dsh-qqbot/${PLUGIN_VERSION} (Node/${process.versions.node}; ${os.platform()})`;
}
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
export function getProfileDir(baseDir = PLUGIN_ROOT) {
    // 主策略：跨过 node_modules 边界后，优先命中 cordis.patch.yml（凭据写入
    // 目标），其次 pnpm-workspace.yaml。跨越守卫是关键——插件包自身随包携带
    // cordis.patch.yml（dsh.bundle.patch 分发物）、源码 checkout 根也有同名
    // 仓库文件，二者都会让「从 PLUGIN_ROOT 起步的探测」命中插件自己；只有
    // 位于 node_modules 之上的目录才可能是拥有该插件的 profile。
    const byPatch = findProfileAncestor(baseDir, (dir) => existsSync(resolve(dir, 'cordis.patch.yml')) ? dir : null);
    if (byPatch !== null)
        return byPatch;
    const byWorkspace = findProfileAncestor(baseDir, (dir) => existsSync(resolve(dir, 'pnpm-workspace.yaml')) ? dir : null);
    if (byWorkspace !== null)
        return byWorkspace;
    // 兜底：npm 浅层布局 / 尚未写入任何标志文件的全新 profile
    // （第一个 node_modules 目录的父目录，与旧版行为一致）
    let dir = baseDir;
    for (let i = 0; i < 32; i++) {
        if (basename(dir) === 'node_modules')
            return dirname(dir);
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
/**
 * 沿目录树向上探测 profile 候选：仅接受「已经跨过至少一个名为
 * node_modules 的路径组件」之后命中的目录（兼容 Windows 分隔符与
 * pnpm 嵌套结构；dev 源码 checkout 不跨边界 → 返回 null → 环境变量引导）。
 */
function findProfileAncestor(baseDir, probe) {
    let crossedNodeModules = false;
    let dir = baseDir;
    for (let i = 0; i < 32; i++) {
        if (basename(dir) === 'node_modules')
            crossedNodeModules = true;
        if (crossedNodeModules) {
            const hit = probe(dir);
            if (hit !== null)
                return hit;
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
/**
 * 解析环境变量占位配置
 */
export function resolveEnv(configValue, envKey) {
    if (configValue && configValue !== '__FROM_ENV__' && !configValue.startsWith('process.env')) {
        return configValue;
    }
    return process.env[envKey] ?? '';
}
/**
 * 格式化相对时间
 */
export function formatRelativeTime(ts) {
    if (!ts)
        return '—';
    const diff = Date.now() - ts;
    if (diff < 60_000)
        return `${Math.floor(diff / 1000)}s 前`;
    if (diff < 3_600_000)
        return `${Math.floor(diff / 60_000)}m 前`;
    if (diff < 86_400_000)
        return `${Math.floor(diff / 3_600_000)}h 前`;
    return `${Math.floor(diff / 86_400_000)}d 前`;
}
//# sourceMappingURL=utils.js.map