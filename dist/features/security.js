/**
 * 安全门控 —— 限制机器人可访问的路径，防止主机信息外泄。
 *
 * 允许范围：`security.workspace`（默认 D:\QQat）、DSH 数据目录、DSH 安装目录
 * （`security.dshRoot`，留空则不启用）、`security.extraRoots`。
 * 任何工具（发文件、ComfyUI 产物等）在读写用户可见文件前都必须过这里。
 */
import { realpathSync, existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
/** 敏感文件名：即使落在允许目录里也不读 */
const SENSITIVE = /(^|\/)(\.credentials|settings\.ya?ml|\.env(\..*)?|id_rsa|id_ed25519|\.ssh|ntuser\.dat|sam|system)(\/|$)/i;
/** 工作区根目录（默认 D:\QQat，可配置） */
export function workspaceRoot(config) {
    const configured = String(config?.security?.workspace ?? '').trim();
    return resolve(configured || 'D:/QQat');
}
/** 允许访问的根目录 */
export function securityRoots(config) {
    const extra = Array.isArray(config?.security?.extraRoots) ? config.security.extraRoots : [];
    const dshRoot = String(config?.security?.dshRoot ?? '').trim();
    const roots = [
        workspaceRoot(config),
        resolve(homedir(), '.dsh'),
        resolve(homedir(), '.dsh-qqbot'),
        ...(dshRoot ? [resolve(dshRoot)] : []),
        ...extra.map((item) => resolve(String(item))),
    ];
    return [...new Set(roots)];
}
/** 是否位于某个根目录内（按真实路径判断，防符号链接逃逸） */
function within(path, root) {
    const rel = relative(root, path);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
/** 路径是否允许访问 */
export function isPathAllowed(path, config) {
    if (config?.security?.enabled === false)
        return true;
    if (typeof path !== 'string' || path.trim() === '')
        return false;
    let real;
    try {
        real = existsSync(path) ? realpathSync(path) : resolve(path);
    }
    catch {
        return false;
    }
    if (SENSITIVE.test(real.replace(/\\/g, '/')))
        return false;
    return securityRoots(config).some((root) => {
        let realRoot = root;
        try {
            realRoot = existsSync(root) ? realpathSync(root) : root;
        }
        catch {
            // 保留 resolve 结果
        }
        return within(real, realRoot);
    });
}
/** 校验并返回绝对路径；越界直接抛错（给模型看的错误信息） */
export function assertPathAllowed(path, config, label = 'path') {
    const abs = resolve(String(path));
    if (!isPathAllowed(abs, config)) {
        throw new Error(`${label}: 路径不在允许范围内（仅限 D:\\QQat 与 DSH 数据目录）: ${abs}`);
    }
    return abs;
}
//# sourceMappingURL=security.js.map
