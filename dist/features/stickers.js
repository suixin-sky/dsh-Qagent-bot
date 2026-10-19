/**
 * 表情包库 —— 本地图片目录 + 标签 + qqbot_send_sticker 工具。
 *
 * 目录约定（标签取子目录名，最多两层）：
 *   <dir>/笑/xxx.jpg
 *   <dir>/无语/yyy.png
 *   <dir>/二次元/zzz.gif
 * 平铺文件按文件名前缀取标签：`笑_01.png` → 标签「笑」。
 *
 * 设计上只读本地文件，不接受 URL/任意路径，避免模型乱发图。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
/** 表情包根目录（可用 sticker.dir 覆盖） */
export function stickerRoot(config) {
    const dir = String(config?.sticker?.dir ?? '').trim();
    return dir ? resolve(dir) : join(homedir(), '.dsh-qqbot', 'stickers');
}
let cache = { dir: '', at: 0, files: [] };
/** 扫描图库（60s 缓存，避免每条消息都走盘） */
export function scanStickers(config, options = {}) {
    const dir = stickerRoot(config);
    const now = Date.now();
    if (!options.force && cache.dir === dir && now - cache.at < 60_000)
        return cache.files;
    const files = [];
    if (existsSync(dir)) {
        walk(dir, dir, files, 0);
    }
    cache = { dir, at: now, files };
    return files;
}
function walk(root, dir, out, depth) {
    let entries = [];
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (depth < 2)
                walk(root, abs, out, depth + 1);
            continue;
        }
        if (!IMAGE_EXT.test(entry.name))
            continue;
        if (!isFile(abs))
            continue;
        out.push({ path: abs, name: entry.name, tag: tagOf(root, abs), rel: relative(root, abs) });
    }
}
function isFile(path) {
    try {
        return statSync(path).isFile();
    }
    catch {
        return false;
    }
}
/** 标签：子目录名；平铺文件取文件名前缀 */
function tagOf(root, abs) {
    const rel = relative(root, abs);
    const parts = rel.split(sep);
    if (parts.length > 1)
        return parts[0];
    const stem = basename(abs, extname(abs));
    const m = /^([^_\-—\s]{1,12})[_\-\s]/.exec(stem);
    return m ? m[1] : 'default';
}
/** 标签统计，按数量倒序 */
export function stickerTags(config) {
    const counts = new Map();
    for (const file of scanStickers(config)) {
        counts.set(file.tag, (counts.get(file.tag) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
let manifestCache = { dir: '', at: 0, manifest: undefined };
/** 读取图库根目录下的 manifest.json（可选的分类描述） */
export function stickerManifest(config) {
    const dir = stickerRoot(config);
    const now = Date.now();
    if (manifestCache.dir === dir && now - manifestCache.at < 60_000)
        return manifestCache.manifest;
    let manifest;
    try {
        // 源文件带 UTF-8 BOM，JSON.parse 会直接报错，先剥掉
        const raw = readFileSync(join(dir, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '');
        manifest = JSON.parse(raw);
    }
    catch {
        manifest = undefined;
    }
    manifestCache = { dir, at: now, manifest };
    return manifest;
}
/** 标签 + 数量 + 分类描述（manifest.categories[tag].description） */
export function stickerCategories(config) {
    const manifest = stickerManifest(config);
    const categories = manifest?.categories ?? {};
    // 少数分类名带零宽字符（‌_kg 之类），做一份归一化后的索引兜底
    const normalized = {};
    for (const [key, value] of Object.entries(categories)) {
        normalized[key.replace(/[\u200B-\u200D\uFEFF]/g, '')] = value;
    }
    return stickerTags(config).map((item) => {
        const entry = categories[item.tag] ?? normalized[item.tag.replace(/[\u200B-\u200D\uFEFF]/g, '')];
        const description = typeof entry?.description === 'string' ? entry.description.trim() : '';
        return { ...item, description };
    });
}
/**
 * 选一张表情包。
 *
 * - `name`：精确文件名（可带子目录），命中即用
 * - `tag`：按标签筛选，随机挑一张
 * - 都不传：全库随机
 */
export function pickSticker(config, options = {}) {
    const files = scanStickers(config);
    if (files.length === 0)
        return undefined;
    const name = String(options.name ?? '').trim();
    if (name) {
        const hit = files.find((f) => f.name === name) ?? files.find((f) => f.rel === name) ?? files.find((f) => f.rel.endsWith(name));
        return hit;
    }
    const tag = String(options.tag ?? '').trim();
    const pool = tag ? files.filter((f) => f.tag === tag) : files;
    if (pool.length === 0)
        return undefined;
    const index = Math.floor(Math.random() * pool.length) % pool.length;
    return pool[index];
}
/** 表情包工具名 */
export const STICKER_TOOL_NAME = 'qqbot_send_sticker';
/** 注册 qqbot_send_sticker 工具（仅发送本地图库里的图片） */
export function registerStickerTool(ctx, sender, manager, config, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-qqbot: tools 服务不可用，qqbot_send_sticker 工具未注册');
        return;
    }
    const categories = stickerCategories(config);
    const tagList = categories.map((t) => `${t.tag}(${t.count})`).join('、') || '（图库为空）';
    // 分类语义来自 manifest.json：让模型按场景描述选，而不是猜标签名
    const tagDoc = categories
        .filter((t) => t.description)
        .map((t) => `- ${t.tag}: ${t.description.length > 22 ? `${t.description.slice(0, 22)}…` : t.description}`)
        .join('\n');
    tools.register({
        name: STICKER_TOOL_NAME,
        description: `Send a meme/sticker image to the current QQ conversation. Available tags: ${tagList}.\n`
            + (tagDoc ? `Pick the tag whose scene description best matches the moment:\n${tagDoc}\n` : '')
            + 'Use it when a meme genuinely fits the mood, like a real group member would — not after every message. '
            + 'Prefer "tag" (random pick within that mood); pass "name" only when the user asked for a specific sticker. '
            + 'Never use it to deliver files or screenshots — that is qqbot_send_file.',
        parameters: {
            type: 'object',
            properties: {
                tag: {
                    type: 'string',
                    description: `Mood tag, one of: ${categories.map((t) => t.tag).join(', ') || '(none)'}. Omit for a random sticker.`,
                },
                name: {
                    type: 'string',
                    description: 'Optional exact sticker file name (use only when the user asked for a specific one).',
                },
            },
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    tag: { type: 'string' },
                    fileName: { type: 'string' },
                    messageId: { type: 'string' },
                },
                required: ['tag', 'fileName'],
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: `已发送表情包 ${value.fileName}（标签：${value.tag}）` }],
        },
        async execute(args = {}, exec) {
            const record = exec?.agent !== undefined ? manager.findByAgent(exec.agent) : undefined;
            if (!record) {
                throw new Error(`${STICKER_TOOL_NAME}: 无法定位当前 QQ 会话（可能不在 QQ 对话里）`);
            }
            const picked = pickSticker(config, { tag: args.tag, name: args.name });
            if (!picked) {
                const available = stickerTags(config).map((t) => t.tag).join('、') || '（图库为空）';
                throw new Error(`${STICKER_TOOL_NAME}: 没有匹配的表情包（可用标签：${available}）`);
            }
            const result = await sender.sendImage(record.replyTarget, { localPath: picked.path });
            logger.info(`im-qqbot: ${STICKER_TOOL_NAME} 发送 ${picked.rel} → ${record.scope}:${record.peerId}`);
            return {
                tag: picked.tag,
                fileName: picked.name,
                ...(result?.message?.id !== undefined ? { messageId: result.message.id } : {}),
            };
        },
    });
    logger.info(`im-qqbot: ${STICKER_TOOL_NAME} 工具已注册（${categories.length} 个标签 / ${categories.reduce((n, t) => n + t.count, 0)} 张）`);
}
//# sourceMappingURL=stickers.js.map
