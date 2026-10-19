/**
 * QQ Bot 凭据持久化 — 写入 dsh profile 的 cordis.patch.yml
 *
 * 用 js-yaml 解析现有文件后更新/追加 im-qqbot 条目，再 dump 写回，
 * 保证输出始终是合法 YAML。文件不存在或为空时安全重建；
 * 解析失败或结构异常时拒绝写入、保留原文件（避免覆盖用户其他配置）。
 */
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import yaml from 'js-yaml';
/**
 * 将凭据写入 dsh profile 的 cordis.patch.yml
 *
 * 用 js-yaml 解析现有文件后更新/追加 im-qqbot 条目，再 dump 写回，
 * 保证输出始终是合法 YAML。文件不存在或为空时安全重建；
 * 解析失败或结构异常时拒绝写入、保留原文件（避免覆盖用户其他配置）。
 */
export function persistCredentialsToProfile(credentials, profileDir, logger) {
    const log = logger ?? console;
    const dir = profileDir;
    if (!dir) {
        // 开发模式：插件从源码加载、不在 node_modules 下，无法定位 profile 目录
        printEnvInstructions(credentials);
        return false;
    }
    const patchPath = resolve(dir, 'cordis.patch.yml');
    try {
        // 1. 解析现有条目（文件不存在/为空才重建；解析失败会抛错，保留原文件）
        let entries = [];
        if (existsSync(patchPath)) {
            entries = parsePatchEntries(readFileSync(patchPath, 'utf8'));
        }
        // 2. 查找已有 im-qqbot 条目
        const existing = entries.find((e) => e.id === 'im-qqbot');
        if (existing) {
            // 更新已有条目的 config
            existing.config = {
                ...(existing.config ?? {}),
                appId: credentials.appId,
                appSecret: credentials.appSecret,
            };
        }
        else {
            // 追加新条目
            entries.push({
                id: 'im-qqbot',
                config: {
                    appId: credentials.appId,
                    appSecret: credentials.appSecret,
                },
            });
        }
        // 3. dump 写回（保证合法 YAML）
        //    先确保 profile 目录存在（文件不存在时也能正常创建，而非误入 ENOENT）
        const output = `# QQ 机器人凭据（扫码绑定自动生成）\n${yaml.dump(entries)}`;
        mkdirSync(dir, { recursive: true });
        writeFileSync(patchPath, output, 'utf8');
        log.info(`✔ 凭据已写入: ${patchPath}`);
        log.info(`  下次启动将自动使用保存的凭据`);
        return true;
    }
    catch (err) {
        log.warn(`写入配置失败: ${err instanceof Error ? err.message : String(err)}`);
        printYamlInstructions(credentials, patchPath);
        return false;
    }
}
/**
 * 从 dsh profile 的 cordis.patch.yml 中移除已保存的凭据（解绑）。
 *
 * 保留 im-qqbot 条目的其余 config（requireMention 等用户配置），
 * 仅删除 appId/appSecret 字段；条目或字段不存在时幂等成功。
 * 移除后写入触发 HMR 重载，插件回到未绑定态（绑定流程重新可用）。
 */
export function removeCredentialsFromProfile(profileDir, logger) {
    const log = logger ?? console;
    if (!profileDir) {
        return false;
    }
    const patchPath = resolve(profileDir, 'cordis.patch.yml');
    try {
        if (!existsSync(patchPath))
            return true; // 无 patch 文件 = 无凭据，幂等成功
        const entries = parsePatchEntries(readFileSync(patchPath, 'utf8'));
        const entry = entries.find((e) => e.id === 'im-qqbot');
        if (entry?.config !== undefined) {
            delete entry.config.appId;
            delete entry.config.appSecret;
        }
        // 无条件写回：幂等场景（凭据字段已不存在）也更新 mtime——
        // 宿主 HMR 靠文件变化触发重载，不写则 bound fiber 永不卸载，
        // 解绑后状态会一直停留在 bound
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(patchPath, yaml.dump(entries), 'utf8');
        log.info(`✔ 凭据已移除: ${patchPath}`);
        log.info(`  插件将重新进入绑定流程`);
        return true;
    }
    catch (err) {
        log.warn(`移除凭据失败: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}
/**
 * 将配置更新合并进 dsh profile 的 cordis.patch.yml（im-qqbot 条目）。
 *
 * 最小写入原则：只把「本次提交的顶层键」合并进条目 config——
 * 不固化 bundle patch 的默认值（保持其版本演进的覆盖能力），
 * 不触碰已保存的凭据字段（appId/appSecret 由绑定/更换/解绑流程管理）。
 * 嵌套对象（如 access）按顶层键整体替换，避免部分合并出混合态。
 * 写入触发 HMR 重载，新 fiber 以新配置启动。
 */
export function updateProfileConfig(configPatch, profileDir, logger) {
    const log = logger ?? console;
    if (!profileDir) {
        log.warn('未定位到 profile 目录，配置无法持久化');
        return false;
    }
    const patchPath = resolve(profileDir, 'cordis.patch.yml');
    try {
        let entries = [];
        if (existsSync(patchPath)) {
            entries = parsePatchEntries(readFileSync(patchPath, 'utf8'));
        }
        const entry = entries.find((e) => e.id === 'im-qqbot');
        if (entry !== undefined) {
            const existing = (entry.config ?? {});
            // 只覆盖提交键；appId/appSecret 由绑定流程管理，防御性保留
            const next = { ...existing };
            for (const [key, value] of Object.entries(configPatch)) {
                if (key === 'appId' || key === 'appSecret')
                    continue;
                next[key] = value;
            }
            entry.config = next;
        }
        else {
            const { appId: _a, appSecret: _s, ...rest } = configPatch;
            entries.push({ id: 'im-qqbot', config: rest });
        }
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(patchPath, yaml.dump(entries), 'utf8');
        log.info(`✔ 配置已保存: ${patchPath}`);
        log.info(`  插件将自动重载`);
        return true;
    }
    catch (err) {
        log.warn(`保存配置失败: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}
/**
 * 解析 cordis.patch.yml 为条目数组
 *
 * - 空内容 / 仅注释（yaml.load 返回 null/undefined）→ 空数组（允许安全重建）
 * - 空数组 `[]` / 条目列表 → 过滤出含 id 的对象
 * - 非空但过滤后无任何可识别条目（如 bundle patch 的 `- insert: [...]`
 *   结构）→ 抛错（由调用方保留原文件——此类文件不是 profile 用户 patch，
 *   整体重写会破坏其原有内容）
 * - 非数组结构 / YAML 语法错误 → 抛错（由调用方保留原文件，避免覆盖用户其他配置）
 */
function parsePatchEntries(content) {
    if (!content.trim())
        return [];
    const parsed = yaml.load(content);
    // 仅注释/空白 → null/undefined，等价于空文件，允许重建
    if (parsed === null || parsed === undefined)
        return [];
    if (!Array.isArray(parsed)) {
        throw new Error('cordis.patch.yml 顶层必须是 YAML 数组');
    }
    const entries = parsed.filter((e) => typeof e === 'object' && e !== null && typeof e.id === 'string');
    if (parsed.length > 0 && entries.length === 0) {
        throw new Error('cordis.patch.yml 含条目但无带 id 的 patch 行（可能是 bundle patch，拒绝写入以保留原文件）');
    }
    return entries;
}
/** 开发模式引导：未定位到 profile 目录，引导用环境变量配置（console.log 确保可见） */
function printEnvInstructions(credentials) {
    console.log('未检测到 profile 目录（开发模式），请通过环境变量配置凭据:');
    if (process.platform === 'win32') {
        // Windows CMD 语法（PowerShell 请用 $env:QQBOT_APPID="xxx"）
        console.log(`  set QQBOT_APPID=${credentials.appId}`);
        console.log(`  set QQBOT_SECRET=${credentials.appSecret}`);
    }
    else {
        console.log(`  export QQBOT_APPID="${credentials.appId}"`);
        console.log(`  export QQBOT_SECRET="${credentials.appSecret}"`);
    }
}
/** 正式安装引导：自动写入失败，引导手动在 cordis.patch.yml 配置（console.log 确保可见） */
function printYamlInstructions(credentials, patchPath) {
    console.log('无法自动保存凭据，请手动打开以下文件添加配置:');
    console.log(`  ${patchPath}`);
    console.log('');
    console.log('  - id: im-qqbot');
    console.log('    config:');
    console.log(`      appId: "${credentials.appId}"`);
    console.log(`      appSecret: "${credentials.appSecret}"`);
}
//# sourceMappingURL=persist.js.map