/** 凭据结果 */
export interface SetupCredentials {
    appId: string;
    appSecret: string;
}
/**
 * 将凭据写入 dsh profile 的 cordis.patch.yml
 *
 * 用 js-yaml 解析现有文件后更新/追加 im-qqbot 条目，再 dump 写回，
 * 保证输出始终是合法 YAML。文件不存在或为空时安全重建；
 * 解析失败或结构异常时拒绝写入、保留原文件（避免覆盖用户其他配置）。
 */
export declare function persistCredentialsToProfile(credentials: SetupCredentials, profileDir?: string, logger?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
}): boolean;
/**
 * 从 dsh profile 的 cordis.patch.yml 中移除已保存的凭据（解绑）。
 *
 * 保留 im-qqbot 条目的其余 config（requireMention 等用户配置），
 * 仅删除 appId/appSecret 字段；条目或字段不存在时幂等成功。
 * 移除后写入触发 HMR 重载，插件回到未绑定态（绑定流程重新可用）。
 */
export declare function removeCredentialsFromProfile(profileDir?: string, logger?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
}): boolean;
/**
 * 将配置更新合并进 dsh profile 的 cordis.patch.yml（im-qqbot 条目）。
 *
 * 最小写入原则：只把「本次提交的顶层键」合并进条目 config——
 * 不固化 bundle patch 的默认值（保持其版本演进的覆盖能力），
 * 不触碰已保存的凭据字段（appId/appSecret 由绑定/更换/解绑流程管理）。
 * 嵌套对象（如 access）按顶层键整体替换，避免部分合并出混合态。
 * 写入触发 HMR 重载，新 fiber 以新配置启动。
 */
export declare function updateProfileConfig(configPatch: Record<string, unknown>, profileDir?: string, logger?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
}): boolean;
//# sourceMappingURL=persist.d.ts.map