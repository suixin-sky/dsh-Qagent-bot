/**
 * 人设提示词 —— 按「当前会话实际使用的模型」选择不同人设。
 *
 * 匹配规则（`config.personas`，从上往下，第一条命中即用）：
 *   - `provider/model` 精确匹配，如 `deepseek-account/deepseek-flash`
 *   - `provider/*` 该 provider 下所有模型，如 `lmstudio/*`
 *   - `*` 兜底
 * 都没命中时用 `config.personaFile`；两者皆空则不注入。
 *
 * 读取带 mtime 缓存：改人设文件不用重载插件，下一轮就生效。
 */
import { readFileSync, statSync } from 'node:fs';
const cache = new Map();
/** 读单个文件，带 mtime 缓存 */
export function loadPersonaFile(file, logger) {
    const path = String(file ?? '').trim();
    if (!path)
        return '';
    try {
        const stat = statSync(path);
        const hit = cache.get(path);
        if (hit && hit.mtime === stat.mtimeMs)
            return hit.text;
        const text = readFileSync(path, 'utf8').trim();
        cache.set(path, { mtime: stat.mtimeMs, text });
        return text;
    }
    catch (err) {
        const hit = cache.get(path);
        if (hit)
            return hit.text;
        logger?.warn?.(`im-qqbot: 人设文件读取失败（${path}）: ${err instanceof Error ? err.message : String(err)}`);
        return '';
    }
}
/** 路由是否匹配某条规则 */
export function personaRuleMatches(rule, route) {
    const sel = String(rule ?? '').trim();
    const provider = String(route?.provider ?? '').trim();
    const model = String(route?.model ?? '').trim();
    if (!sel)
        return false;
    if (sel === '*')
        return true;
    if (sel.endsWith('/*'))
        return provider !== '' && sel.slice(0, -2) === provider;
    return provider !== '' && model !== '' && sel === `${provider}/${model}`;
}
/** 按当前模型路由取人设文本 */
export function personaForRoute(config, route, logger) {
    const entries = Array.isArray(config?.personas) ? config.personas : [];
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object')
            continue;
        if (!personaRuleMatches(entry.match, route))
            continue;
        const text = loadPersonaFile(entry.file, logger);
        if (text)
            return { file: String(entry.file), match: String(entry.match), text };
    }
    const fallback = loadPersonaFile(config?.personaFile, logger);
    return fallback
        ? { file: String(config.personaFile), match: '(default)', text: fallback }
        : undefined;
}
//# sourceMappingURL=persona.js.map
