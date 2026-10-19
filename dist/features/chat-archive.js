/**
 * 聊天归档 —— 把群聊/私聊消息持续落盘成 Markdown + 图片文件夹。
 *
 * 目的：模型（不管当前跑的是 deepseek 还是本地 qwen）在切换/交接后，
 * 仍能按需回看这个会话之前说过什么、发过什么图。
 *
 * 布局：
 *   <dir>/<scope>-<peerId>/chat.md
 *   <dir>/<scope>-<peerId>/images/<yyyymmdd-hhmmss>_<rand>.<ext>
 *   <dir>/<scope>-<peerId>/files/<...>
 *
 * chat.md 结构：
 *   # QQ 聊天记录 · group · <peerId>
 *
 *   ## 2026-10-19
 *
 *   - 00:56:12 [小明] 文本
 *   - 00:58:03 [小明] ![图片](images/20261019-005803_ab12.jpg)
 *
 * 对外：chatArchive 中间件（写入）+ qqbot_chat_log 工具（读取）。
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { downloadMediaAttachments } from '../transport/attachment.js';
import { archiveRoot, peerSlug } from './archive-paths.js';
import { membersSummary, memberName, recordMember, shortId } from './members.js';
export { DEFAULT_ARCHIVE_ROOT, archiveRoot, peerSlug } from './archive-paths.js';
function two(n) {
    return String(n).padStart(2, '0');
}
function dayOf(date) {
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}
function timeOf(date) {
    return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
function stampOf(date) {
    return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}
/** 单行化：去掉换行、压缩空白，避免破坏 md 列表结构 */
function oneLine(text) {
    return String(text ?? '').replace(/\s*\r?\n\s*/g, ' / ').replace(/\s+/g, ' ').trim();
}
/**
 * 把 QQ 的表情标签换成可读文字。
 *
 * 归档跑在 contentSanitizer 之前，拿到的是原始内容：
 *   - 新格式 `<faceType=1,faceId="13",ext="<base64>">`，ext 里是 {"text":"微笑"}
 *   - 老格式 `[<face,id=13/>]`，只有数字 id
 * 统一成 `[表情: 微笑]` / `[表情]`，同时去掉 `<@!appId>` 之类的 @ 标记。
 */
function cleanFaceTags(text, appId) {
    let out = String(text ?? '');
    out = out.replace(/<faceType=\d+,faceId="[^"]*",ext="([^"]*)">/g, (_m, ext) => {
        try {
            const parsed = JSON.parse(Buffer.from(ext, 'base64').toString('utf8'));
            const name = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
            return name ? `[表情: ${name}]` : '[表情]';
        }
        catch {
            return '[表情]';
        }
    });
    out = out.replace(/\[<face,id=\d+\/?>]/g, '[表情]');
    if (appId) {
        const escaped = String(appId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(`<@!?${escaped}>\\s*`, 'g'), '');
    }
    out = out.replace(/<@!?[^>]+>\s*/g, '');
    out = out.replace(/<face[^>]*>/gi, '[表情]');
    return out;
}
/** 图片扩展名兜底（下载文件名可能没有扩展名） */
function extOf(name, contentType) {
    const ext = extname(String(name ?? '')).toLowerCase();
    if (ext)
        return ext;
    if (contentType === 'image')
        return '.jpg';
    if (contentType === 'video')
        return '.mp4';
    return '.bin';
}
// ── 按文件串行写入，保证多群并发时不交错 ──
const writeQueues = new Map();
function serial(key, task) {
    const prev = writeQueues.get(key) ?? Promise.resolve();
    const next = prev.then(task, task).catch(() => { });
    writeQueues.set(key, next);
    return next;
}
/** 记住每个 md 最后写入的日期，避免每条消息都重读文件 */
const lastDay = new Map();
/** 取（或补写）当天的日期小节头 */
function ensureDayHeader(file, date) {
    const day = dayOf(date);
    if (lastDay.get(file) === day)
        return;
    if (existsSync(file)) {
        const content = readFileSync(file, 'utf8');
        const headers = [...content.matchAll(/^## (\d{4}-\d{2}-\d{2})$/gm)];
        if (headers.length > 0 && headers[headers.length - 1][1] === day) {
            lastDay.set(file, day);
            return;
        }
    }
    appendFileSync(file, `\n## ${day}\n\n`, 'utf8');
    lastDay.set(file, day);
}
/** 首次写入时补文件头 */
function ensureHeader(file, scope, peerId) {
    if (existsSync(file))
        return;
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `# QQ 聊天记录 · ${scope} · ${peerId}\n`, 'utf8');
}
/**
 * 归档一条消息（fire-and-forget 调用，内部吞掉所有异常）。
 *
 * @returns Promise<void>
 */
export async function archiveMessage({ message, state, config, logger }) {
    const cfg = config.archive ?? {};
    if (cfg.enabled === false)
        return;
    const msg = message;
    const scope = msg.kind === 'group' ? 'group' : 'c2c';
    const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;
    if (!peerId)
        return;
    const root = archiveRoot(config);
    const dir = join(root, peerSlug(scope, peerId));
    const file = join(dir, 'chat.md');
    const now = new Date();
    // 私聊事件里没有昵称字段，回落到名录里最近一次记录的名字
    const realName = oneLine(msg.senderName) || memberName(config, msg.senderId);
    const sender = realName || shortId(msg.senderId) || 'unknown';
    // 行内用「名称|短ID」：昵称会改，短 ID（openid 前 8 位）不变
    const tag = `${sender}|${shortId(msg.senderId)}`;
    const text = oneLine(cleanFaceTags(msg.content, config.appId));
    const lines = [];
    // 成员名录：每次发言都记一次，支撑「换名字也能认人」。只记真实昵称，不拿短ID 兜底。
    recordMember(config, { id: msg.senderId, name: oneLine(msg.senderName), scope: `${scope}-${peerId}`, logger });
    if (text)
        lines.push(`- ${timeOf(now)} [${tag}] ${text}`);
    // 附件：先确保本地有文件，再复制进归档目录（media 目录有 24h TTL，不能直接引用）
    const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
    if (cfg.images !== false && attachments.length > 0) {
        let downloaded = state?.downloadedFiles;
        if (!Array.isArray(downloaded) || downloaded.length === 0) {
            try {
                downloaded = await downloadMediaAttachments(attachments, config.media ?? { enabled: true }, logger);
            }
            catch (err) {
                logger?.warn?.(`im-qqbot: archive download failed: ${err instanceof Error ? err.message : String(err)}`);
                downloaded = [];
            }
        }
        for (const hit of downloaded ?? []) {
            if (!hit?.localPath)
                continue;
            const isImage = hit.contentType === 'image';
            const isVideo = hit.contentType === 'video';
            const folder = isImage ? 'images' : isVideo ? 'videos' : 'files';
            const ext = extOf(hit.filename ?? hit.localPath, hit.contentType);
            const name = `${stampOf(now)}_${randomBytes(3).toString('hex')}${ext}`;
            const destDir = join(dir, folder);
            try {
                mkdirSync(destDir, { recursive: true });
                copyFileSync(hit.localPath, join(destDir, name));
            }
            catch (err) {
                logger?.warn?.(`im-qqbot: archive copy failed: ${err instanceof Error ? err.message : String(err)}`);
                continue;
            }
            const shown = oneLine(hit.filename) || basename(name);
            const label = isImage ? '图片' : isVideo ? `视频: ${shown}` : `文件: ${shown}`;
            // 图片用 md 图片语法，视频/普通文件用链接语法
            lines.push(isImage
                ? `- ${timeOf(now)} [${tag}] ![${label}](${folder}/${name})`
                : `- ${timeOf(now)} [${tag}] [${label}](${folder}/${name})`);
        }
        // 收到过附件但一张都没存下来（下载失败/被 media 上限拦住）也要留痕，
        // 否则事后完全看不出「其实发过图」。
        const saved = lines.filter((line) => line.includes('](')).length;
        if (saved === 0 && attachments.length > 0) {
            const kinds = [...new Set(attachments.map((a) => oneLine(a.content_type) || 'unknown'))].join(', ');
            lines.push(`- ${timeOf(now)} [${tag}] [附件未保存: ${kinds}]`);
        }
    }
    if (lines.length === 0)
        return;
    await serial(file, async () => {
        mkdirSync(dir, { recursive: true });
        ensureHeader(file, scope, peerId);
        ensureDayHeader(file, now);
        appendFileSync(file, `${lines.join('\n')}\n`, 'utf8');
    });
}
/** 读取归档：按关键词过滤，或取最近 limit 条；返回文本与图片绝对路径 */
export function readArchive(config, scope, peerId, options = {}) {
    const root = archiveRoot(config);
    const dir = join(root, peerSlug(scope, peerId));
    const file = join(dir, 'chat.md');
    const result = { file, exists: existsSync(file), text: '', images: [] };
    if (!result.exists)
        return result;
    let content;
    try {
        content = readFileSync(file, 'utf8');
    }
    catch {
        return result;
    }
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));
    const days = Number(options.days) || 0;
    let body = content;
    if (days > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - (days - 1));
        const cutoffDay = dayOf(cutoff);
        const parts = body.split(/^## /m);
        body = parts.filter((part, index) => index === 0 || part.slice(0, 10) >= cutoffDay).join('## ');
    }
    let lines = body.split(/\r?\n/).filter((line) => line.startsWith('- '));
    const query = String(options.query ?? '').trim();
    if (query) {
        const needle = query.toLowerCase();
        lines = lines.filter((line) => line.toLowerCase().includes(needle));
        lines = lines.slice(-limit);
    }
    else {
        lines = lines.slice(-limit);
    }
    result.text = lines.join('\n');
    for (const line of lines) {
        const re = /!\[[^\]]*\]\(([^)]+)\)/g;
        let match;
        while ((match = re.exec(line)) !== null) {
            const rel = match[1];
            if (!rel || /^https?:/i.test(rel))
                continue;
            const abs = resolve(dir, rel);
            if (!result.images.includes(abs))
                result.images.push(abs);
        }
    }
    return result;
}
/**
 * 归档中间件：记录所有到达这条链的消息（含未 @ 的群消息）。
 *
 * 不阻塞消息链：写盘/下载在后台进行，失败只打日志。
 */
export function chatArchiver(config, logger) {
    return async (ctx, next) => {
        void archiveMessage({ message: ctx.message, state: ctx.state, config, logger }).catch((err) => {
            logger?.warn?.(`im-qqbot: archive failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        await next();
    };
}
/** 工具名 */
export const CHAT_LOG_TOOL_NAME = 'qqbot_chat_log';
/**
 * 注册 qqbot_chat_log 工具。
 *
 * 只允许读取「当前会话」的归档，不提供跨会话浏览，避免把别的群内容带进来。
 */
export function registerChatLogTool(ctx, manager, config, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-qqbot: tools 服务不可用，qqbot_chat_log 工具未注册');
        return;
    }
    const root = archiveRoot(config);
    tools.register({
        name: CHAT_LOG_TOOL_NAME,
        description: 'Read this QQ conversation\'s archived chat log (Markdown, one file per conversation; images and files are '
            + 'saved next to it). Use it whenever the user asks you to look at earlier messages, "刚才/昨天/之前说的", '
            + 'or images/files that were sent in this chat. Returns matching log lines plus absolute paths of any '
            + 'images referenced by those lines.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Optional case-insensitive keyword to filter log lines (e.g. a name or topic). Omit for the most recent lines.',
                },
                limit: {
                    type: 'integer',
                    description: 'Maximum number of lines to return (default 50, max 500).',
                    minimum: 1,
                    maximum: 500,
                },
                days: {
                    type: 'integer',
                    description: 'Only look at the last N days (default: all days in the archive).',
                    minimum: 1,
                },
            },
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    file: { type: 'string' },
                    text: { type: 'string' },
                    images: { type: 'array', items: { type: 'string' } },
                },
                required: ['file', 'text', 'images'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value;
                const head = v.text ? v.text : '（归档里没有匹配的记录）';
                const pics = v.images.length > 0 ? `\n\n图片：\n${v.images.map((p) => `- ${p}`).join('\n')}` : '';
                return [{ type: 'text', text: `${head}${pics}` }];
            },
        },
        async execute(args = {}, exec) {
            const record = exec?.agent !== undefined ? manager.findByAgent(exec.agent) : undefined;
            if (!record) {
                throw new Error(`${CHAT_LOG_TOOL_NAME}: 无法定位当前 QQ 会话（可能不在 QQ 对话里）`);
            }
            const result = readArchive(config, record.scope, record.peerId, {
                query: args.query,
                limit: args.limit,
                days: args.days,
            });
            if (!result.exists) {
                return {
                    file: result.file,
                    text: `该会话还没有归档记录（归档目录：${root}）`,
                    images: [],
                };
            }
            return { file: result.file, text: result.text, images: result.images };
        },
    });
    logger.info(`im-qqbot: ${CHAT_LOG_TOOL_NAME} 工具已注册（归档目录 ${root}）`);
}
/** 日期字符串 yyyy-mm-dd */
function dayString(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
/**
 * 归档保留策略。
 *
 * - `archive.textKeepDays`：文本保留天数（默认 20），超期整段日期小节删掉
 * - `archive.mediaKeepDays`：图片/视频保留天数（默认 10），超期日期小节里
 *   的媒体引用行删掉，对应文件一并删除
 * - 未被 md 引用的媒体文件（写一半失败等产生的孤儿）也会被清掉
 *
 * 两者都为 0 时跳过。返回统计，便于日志观察。
 */
export function pruneArchive(config, logger, now = Date.now()) {
    const cfg = config?.archive ?? {};
    const result = { peers: 0, removedSections: 0, removedFiles: 0 };
    if (cfg.enabled === false)
        return result;
    const textDays = Number(cfg.textKeepDays) || 0;
    const mediaDays = Number(cfg.mediaKeepDays) || 0;
    if (textDays <= 0 && mediaDays <= 0)
        return result;
    const root = archiveRoot(config);
    if (!existsSync(root))
        return result;
    const DAY = 86400000;
    const textCutoff = textDays > 0 ? dayString(now - (textDays - 1) * DAY) : '';
    const mediaCutoff = mediaDays > 0 ? dayString(now - (mediaDays - 1) * DAY) : '';
    let peers = [];
    try {
        peers = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    }
    catch {
        return result;
    }
    for (const peer of peers) {
        const file = join(root, peer, 'chat.md');
        if (!existsSync(file))
            continue;
        result.peers += 1;
        let content;
        try {
            content = readFileSync(file, 'utf8');
        }
        catch {
            continue;
        }
        // parts: [header, day1, body1, day2, body2, ...]
        const parts = content.split(/^## (\d{4}-\d{2}-\d{2})$/m);
        const header = parts[0] ?? '';
        const sections = [];
        for (let i = 1; i < parts.length; i += 2) {
            sections.push({ day: parts[i], body: parts[i + 1] ?? '' });
        }
        const kept = [];
        for (const section of sections) {
            if (textCutoff && section.day < textCutoff) {
                result.removedSections += 1;
                continue;
            }
            let body = section.body;
            if (mediaCutoff && section.day < mediaCutoff) {
                body = body
                    .split('\n')
                    .filter((line) => !/\]\((?:images|videos)\//.test(line))
                    .join('\n');
            }
            kept.push({ day: section.day, body });
        }
        const rewritten = header + kept.map((section) => `## ${section.day}${section.body}`).join('');
        if (rewritten !== content) {
            try {
                const tmp = `${file}.tmp`;
                writeFileSync(tmp, rewritten, 'utf8');
                renameSync(tmp, file);
            }
            catch (err) {
                logger?.warn?.(`im-qqbot: archive prune write failed: ${err instanceof Error ? err.message : String(err)}`);
                continue;
            }
        }
        // 清掉 md 不再引用、且本身已超过媒体保留期的图片/视频。
        // 只按「文件名字里的时间戳」判断年龄：认不出年龄的文件一律保留（更安全）。
        if (mediaCutoff) {
            const referenced = new Set();
            for (const match of rewritten.matchAll(/\]\(((?:images|videos)\/[^)]+)\)/g)) {
                referenced.add(join(root, peer, match[1]));
            }
            for (const folder of ['images', 'videos']) {
                const dir = join(root, peer, folder);
                if (!existsSync(dir))
                    continue;
                let names = [];
                try {
                    names = readdirSync(dir);
                }
                catch {
                    continue;
                }
                for (const name of names) {
                    const abs = join(dir, name);
                    if (referenced.has(abs))
                        continue;
                    // 优先用文件名里的时间戳；认不出就用文件的修改时间（也就是落盘时间）
                    let fileDay = '';
                    const stamp = /^(\d{4})(\d{2})(\d{2})-/.exec(name);
                    if (stamp) {
                        fileDay = `${stamp[1]}-${stamp[2]}-${stamp[3]}`;
                    }
                    else {
                        try {
                            fileDay = dayString(statSync(abs).mtimeMs);
                        }
                        catch {
                            continue; // 连 stat 都失败就跳过，下次再清
                        }
                    }
                    if (fileDay >= mediaCutoff)
                        continue;
                    try {
                        unlinkSync(abs);
                        result.removedFiles += 1;
                    }
                    catch {
                        // 文件被占用等情况跳过，下次再清
                    }
                }
            }
        }
    }
    if (result.removedSections > 0 || result.removedFiles > 0 || result.peers > 0) {
        logger?.info?.(`im-qqbot: archive prune — peers=${result.peers} sections=${result.removedSections} files=${result.removedFiles}`);
    }
    return result;
}
/** 成员名录工具名 */
export const MEMBERS_TOOL_NAME = 'qqbot_members';
/**
 * 注册 qqbot_members 工具 —— 按名称/曾用名/openid 查询成员名录。
 */
export function registerMembersTool(ctx, config, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-qqbot: tools 服务不可用，qqbot_members 工具未注册');
        return;
    }
    tools.register({
        name: MEMBERS_TOOL_NAME,
        description: 'Look up people who have talked to this bot: stable openid, current display name and former names. '
            + 'Use it when you need to know who someone is, or to map a nickname to a stable identity '
            + '(QQ display names change; openid does not).',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Optional name / former name / openid substring. Omit to list the most recently active members.',
                },
                limit: {
                    type: 'integer',
                    description: 'Max rows to return (default 50, max 200).',
                    minimum: 1,
                    maximum: 200,
                },
            },
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    file: { type: 'string' },
                    total: { type: 'integer' },
                    text: { type: 'string' },
                },
                required: ['file', 'total', 'text'],
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        async execute(args = {}) {
            return membersSummary(config, { query: args.query, limit: args.limit });
        },
    });
    logger.info(`im-qqbot: ${MEMBERS_TOOL_NAME} 工具已注册`);
}
/** 归档图片发送工具名 */
export const SEND_ARCHIVED_IMAGE_TOOL_NAME = 'qqbot_send_archived_image';
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
/** 列出某会话归档里的图片（按时间倒序，文件名前缀就是时间戳） */
export function listArchivedImages(config, scope, peerId) {
    const dir = join(archiveRoot(config), peerSlug(scope, peerId), 'images');
    if (!existsSync(dir))
        return [];
    try {
        return readdirSync(dir).filter((name) => IMAGE_RE.test(name)).sort().reverse();
    }
    catch {
        return [];
    }
}
/**
 * 注册 qqbot_send_archived_image 工具。
 *
 * 只允许发送「本会话归档目录里的图」，且语义上要求用户明确点名要哪张：
 * index=1 表示最近一张（对应「把刚才那张图发我」）。别的路径一律发不了，
 * 从结构上堵住「随手发图」。
 */
export function registerSendArchivedImageTool(ctx, sender, manager, config, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-qqbot: tools 服务不可用，qqbot_send_archived_image 工具未注册');
        return;
    }
    tools.register({
        name: SEND_ARCHIVED_IMAGE_TOOL_NAME,
        description: 'Send an image that was ALREADY POSTED in this QQ conversation. Use it ONLY when the user explicitly '
            + 'asks for a specific earlier image ("把刚才那张图发我" → index 1; "昨天那张截图" → locate it with '
            + 'qqbot_chat_log first, then pass its file_name). Never send images unless the user asked for one.',
        parameters: {
            type: 'object',
            properties: {
                index: {
                    type: 'integer',
                    description: '1 = the most recent image in this conversation (default 1), 2 = second most recent, etc.',
                    minimum: 1,
                },
                file_name: {
                    type: 'string',
                    description: 'Optional exact image file name from this conversation (as shown by qqbot_chat_log). Takes precedence over index.',
                },
            },
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    fileName: { type: 'string' },
                    index: { type: 'integer' },
                    total: { type: 'integer' },
                    filePath: { type: 'string' },
                    messageId: { type: 'string' },
                },
                required: ['fileName', 'index', 'total', 'filePath'],
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: `已发送归档图片 ${value.fileName}（第 ${value.index}/${value.total} 张）` }],
        },
        async execute(args = {}, exec) {
            const record = exec?.agent !== undefined ? manager.findByAgent(exec.agent) : undefined;
            if (!record) {
                throw new Error(`${SEND_ARCHIVED_IMAGE_TOOL_NAME}: 无法定位当前 QQ 会话（可能不在 QQ 对话里）`);
            }
            const images = listArchivedImages(config, record.scope, record.peerId);
            if (images.length === 0) {
                throw new Error(`${SEND_ARCHIVED_IMAGE_TOOL_NAME}: 本会话还没有归档图片`);
            }
            let fileName;
            if (typeof args.file_name === 'string' && args.file_name.trim() !== '') {
                const wanted = args.file_name.trim();
                if (!images.includes(wanted)) {
                    throw new Error(`${SEND_ARCHIVED_IMAGE_TOOL_NAME}: 本会话归档里没有这张图: ${wanted}`);
                }
                fileName = wanted;
            }
            else {
                const index = Math.max(1, Number(args.index) || 1);
                if (index > images.length) {
                    throw new Error(`${SEND_ARCHIVED_IMAGE_TOOL_NAME}: 只有 ${images.length} 张图，没有第 ${index} 张`);
                }
                fileName = images[index - 1];
            }
            const filePath = join(archiveRoot(config), peerSlug(record.scope, record.peerId), 'images', fileName);
            const result = await sender.sendImage(record.replyTarget, { localPath: filePath });
            logger.info(`im-qqbot: ${SEND_ARCHIVED_IMAGE_TOOL_NAME} 发送 ${fileName} → ${record.scope}:${record.peerId}`);
            return {
                fileName,
                index: images.indexOf(fileName) + 1,
                total: images.length,
                filePath,
                ...(result?.message?.id !== undefined ? { messageId: result.message.id } : {}),
            };
        },
    });
    logger.info(`im-qqbot: ${SEND_ARCHIVED_IMAGE_TOOL_NAME} 工具已注册`);
}
//# sourceMappingURL=chat-archive.js.map
