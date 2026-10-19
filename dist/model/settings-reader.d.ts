import type { ModelRoute, ModelEntry } from './types.ts';
export declare class SettingsReader {
    /** settings.yaml 缓存 */
    private settingsCache;
    /**
     * 从 settings.yaml 的 agent-default-model 字段读取默认模型路由
     */
    readDefaultRoute(): ModelRoute | undefined;
    /**
     * 列出 settings.yaml 中配置的所有模型
     */
    readModels(): ModelEntry[];
    /**
     * 列出 settings.yaml 中配置的 provider 名称
     */
    readProviders(): string[];
    private loadSettings;
}
//# sourceMappingURL=settings-reader.d.ts.map