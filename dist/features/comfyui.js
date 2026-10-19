/**
 * ComfyUI 接入 —— 把 MiniMax H3 工作流变成模型可调用的工具。
 *
 * 关键点：
 * - 工作流只读：每次生成时从磁盘读 JSON，转换在内存里做，用完即弃，绝不回写。
 * - UI 工作流 → API graph：从输出节点反向遍历，跳过 bypass（mode 4）并做类型透传，
 *   动态输入（`values.a` / `ref_images.ref_image_0`）保持带点的扁平键。
 * - 参数注入：提示词 → 文本节点，时长 → 时长节点，画质 → 分辨率节点。
 * - 生成完下载到临时目录，发到群里后立即删除；带进度提示。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { assertPathAllowed, workspaceRoot } from './security.js';

const SKIP_WIDGETS = new Set(['videopreview', 'choose video to upload', 'upload']);
const UI_ONLY = new Set(['MarkdownNote', 'Fast Groups Bypasser (rgthree)', 'Note', 'Reroute']);

/** 工作流必须放在工作区目录内（硬约束：只允许用用户放进来的那份） */
export function assertWorkflowPath(path, config) {
    const root = workspaceRoot(config);
    const abs = resolve(String(path ?? ''));
    const rel = relative(root, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`ComfyUI 工作流必须放在 ${root} 内（当前: ${abs}）`);
    }
    return abs;
}
/** 读工作流（带 mtime 缓存，只读不写） */
let workflowCache = { path: '', mtime: 0, data: undefined };
export function loadWorkflow(config, logger) {
    const path = String(config?.comfyui?.workflow ?? '').trim();
    if (!path)
        throw new Error('comfyui.workflow 未配置');
    const abs = assertWorkflowPath(path, config);
    try {
        const stat = statSync(abs);
        if (workflowCache.path === abs && workflowCache.mtime === stat.mtimeMs && workflowCache.data) {
            return workflowCache.data;
        }
        const data = JSON.parse(readFileSync(abs, 'utf8'));
        workflowCache = { path: abs, mtime: stat.mtimeMs, data };
        return data;
    }
    catch (err) {
        logger?.warn?.(`im-qqbot: 读取工作流失败（${abs}）: ${err instanceof Error ? err.message : String(err)}`);
        throw new Error(`无法读取 ComfyUI 工作流: ${abs}`);
    }
}

/** object_info 缓存（默认值补齐用） */
let objectInfoCache = { at: 0, data: undefined };
export async function getObjectInfo(baseUrl) {
    if (objectInfoCache.data && Date.now() - objectInfoCache.at < 10 * 60 * 1000) {
        return objectInfoCache.data;
    }
    const res = await fetch(`${baseUrl}/object_info`);
    if (!res.ok)
        throw new Error(`object_info 获取失败: HTTP ${res.status}`);
    const data = await res.json();
    objectInfoCache = { at: Date.now(), data };
    return data;
}

/** UI 工作流 → API graph */
export function workflowToApi(workflow, overrides = {}) {
    const nodes = new Map((workflow.nodes ?? []).map((n) => [String(n.id), n]));
    const links = new Map((workflow.links ?? []).map((l) => [String(l[0]), l]));
    const resolveLink = (linkId, depth = 0) => {
        if (linkId == null || depth > 30)
            return null;
        const link = links.get(String(linkId));
        if (!link)
            return null;
        const [, originId, originSlot, , , type] = link;
        const origin = nodes.get(String(originId));
        if (!origin)
            return null;
        if (origin.mode !== 4)
            return { id: String(originId), slot: originSlot, type };
        // bypass：按类型找上游，穿透过去
        const candidate = (origin.inputs ?? []).find((i) => i.link != null && i.type === type);
        return candidate ? resolveLink(candidate.link, depth + 1) : null;
    };
    const outputId = (() => {
        for (const node of workflow.nodes ?? []) {
            if (node.mode === 0 && (node.type === 'VHS_VideoCombine' || node.type === 'SaveVideo'))
                return String(node.id);
        }
        throw new Error('工作流里找不到输出节点（VHS_VideoCombine / SaveVideo）');
    })();
    const visited = new Set();
    const stack = [outputId];
    while (stack.length) {
        const id = stack.pop();
        if (visited.has(id))
            continue;
        const node = nodes.get(id);
        if (!node || node.mode !== 0 || UI_ONLY.has(node.type))
            continue;
        visited.add(id);
        for (const input of node.inputs ?? []) {
            if (input.link == null)
                continue;
            const src = resolveLink(input.link);
            if (src)
                stack.push(src.id);
        }
    }
    const api = {};
    for (const id of visited) {
        const node = nodes.get(id);
        const inputs = {};
        for (const [key, value] of Object.entries(node.widgets_values_named ?? {})) {
            if (!SKIP_WIDGETS.has(key))
                inputs[key] = value;
        }
        for (const input of node.inputs ?? []) {
            if (input.link == null)
                continue;
            const src = resolveLink(input.link);
            if (!src)
                continue;
            // 动态输入保持 `values.a` 这种扁平键（ComfyUI 服务端按此校验）
            inputs[input.name] = [src.id, src.slot];
        }
        api[id] = { class_type: node.type, inputs };
    }
    // 参数注入：提示词 / 时长 / 画质
    const promptNode = findNodeByType(nodes, visited, 'PrimitiveStringMultiline');
    if (promptNode && overrides.prompt !== undefined)
        api[promptNode].inputs.value = overrides.prompt;
    const durationNode = findPrimitiveFloat(nodes, visited, 'Duration');
    if (durationNode && overrides.seconds !== undefined)
        api[durationNode].inputs.value = overrides.seconds;
    const resolutionNode = findNodeByType(nodes, visited, 'ResolutionSelector');
    if (resolutionNode && overrides.megapixels !== undefined)
        api[resolutionNode].inputs.megapixels = overrides.megapixels;
    const imageNode = findNodeByType(nodes, visited, 'LoadImage');
    // 参考图：有就换图；没有就把 ref_* 输入全摘掉（纯文生视频）
    if (imageNode && overrides.image) {
        api[imageNode].inputs.image = overrides.image;
    }
    if (imageNode && !overrides.image) {
        const h3Node = findNodeByType(nodes, visited, 'MiniMaxH3ReferenceToVideo');
        if (h3Node)
            api[h3Node].inputs = stripRefs(api[h3Node].inputs);
    }
    // 剪掉不可达节点
    const keep = new Set();
    const walk = (id) => {
        if (keep.has(id) || !api[id])
            return;
        keep.add(id);
        for (const value of Object.values(api[id].inputs)) {
            if (Array.isArray(value) && typeof value[0] === 'string')
                walk(value[0]);
        }
    };
    walk(outputId);
    for (const id of Object.keys(api))
        if (!keep.has(id))
            delete api[id];
    return { graph: api, outputId };
}

function stripRefs(inputs) {
    const next = { ...inputs };
    for (const key of Object.keys(next)) {
        if (key.startsWith('ref_'))
            delete next[key];
    }
    return next;
}
function findNodeByType(nodes, visited, type) {
    for (const id of visited) {
        if (nodes.get(id)?.type === type)
            return id;
    }
    return undefined;
}
function findPrimitiveFloat(nodes, visited, titleHint) {
    for (const id of visited) {
        const node = nodes.get(id);
        if (node?.type === 'PrimitiveFloat' && String(node.title ?? '').includes(titleHint))
            return id;
    }
    return undefined;
}
/** 用 object_info 默认值补齐缺失的必需输入，并做一次本地校验 */
export async function fillRequiredDefaults(baseUrl, graph) {
    const info = await getObjectInfo(baseUrl);
    const problems = [];
    for (const [id, node] of Object.entries(graph)) {
        const spec = info[node.class_type];
        if (!spec) {
            problems.push(`${id}: 未知节点类型 ${node.class_type}`);
            continue;
        }
        for (const name of spec.input_order?.required ?? []) {
            if (name in node.inputs)
                continue;
            if (Object.keys(node.inputs).some((key) => key.startsWith(`${name}.`)))
                continue;
            const def = spec.input?.required?.[name];
            const opts = Array.isArray(def) ? def[1] : undefined;
            const fallback = opts && 'default' in opts ? opts.default : (Array.isArray(opts?.options) ? opts.options[0] : undefined);
            if (fallback !== undefined) {
                node.inputs[name] = fallback;
                continue;
            }
            problems.push(`${id}:${node.class_type} 缺少必需输入 ${name}`);
        }
    }
    return problems;
}
/** 上传参考图到 ComfyUI input 目录 */
export async function uploadImage(baseUrl, buffer, filename) {
    const form = new FormData();
    form.append('image', new Blob([buffer]), filename);
    form.append('overwrite', 'true');
    const res = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form });
    if (!res.ok)
        throw new Error(`参考图上传失败: HTTP ${res.status}`);
    const data = await res.json();
    return data?.subfolder ? `${data.subfolder}/${data.name}` : data?.name;
}
/** 提交 prompt */
export async function submitPrompt(baseUrl, graph, clientId) {
    const res = await fetch(`${baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: clientId }),
    });
    const text = await res.text();
    if (!res.ok) {
        let detail = text;
        try {
            const parsed = JSON.parse(text);
            const nodeErrors = parsed?.node_errors ?? {};
            const lines = Object.entries(nodeErrors).map(([id, value]) => `${id}: ${JSON.stringify(value?.errors?.map((e) => e.message + ':' + (e.details ?? '')))}`);
            detail = lines.length ? lines.join('; ') : text;
        }
        catch {
            // 保留原始文本
        }
        throw new Error(`ComfyUI 拒绝了工作流: ${detail.slice(0, 500)}`);
    }
    return JSON.parse(text).prompt_id;
}
/** 轮询直到生成结束 */
export async function waitForOutput(baseUrl, promptId, options) {
    const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
    const intervalMs = options.intervalMs ?? 2000;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const res = await fetch(`${baseUrl}/history/${promptId}`);
        if (res.ok) {
            const data = await res.json();
            const entry = data?.[promptId];
            if (entry) {
                if (entry.status?.status_str === 'error') {
                    throw new Error(`ComfyUI 生成失败: ${JSON.stringify(entry.status?.messages ?? []).slice(0, 300)}`);
                }
                return entry;
            }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
        options.onTick?.(Date.now() - started);
    }
    throw new Error(`ComfyUI 生成超时（${Math.round(timeoutMs / 60000)} 分钟）`);
}
/** 从 history 结果里挑出第一份产物 */
export function pickOutput(entry) {
    for (const node of Object.values(entry?.outputs ?? {})) {
        for (const key of ['gifs', 'videos', 'images']) {
            const list = node?.[key];
            if (Array.isArray(list) && list.length > 0)
                return list[0];
        }
    }
    return undefined;
}
/** 下载产物到本地 */
export async function downloadOutput(baseUrl, item, destPath) {
    const params = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder ?? '', type: item.type ?? 'output' });
    const res = await fetch(`${baseUrl}/view?${params.toString()}`);
    if (!res.ok)
        throw new Error(`产物下载失败: HTTP ${res.status}`);
    mkdirSync(join(destPath, '..'), { recursive: true });
    writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
    return destPath;
}
/** 给模型用的提示词格式说明（MiniMax 官方结构） */
export const MINIMAX_FORMAT_HINT = '提示词按 MiniMax 官方格式写：'
    + '以镜头运动开头（如 [Static shot] / [Pan right] / [Tracking shot]），'
    + '然后主体与动作、环境与光线，最后补声音与时长；引用参考图时用 <Picture 1> 指代。'
    + '多段镜头用换行分隔，每段结尾写“N seconds”。';
/** 工具名 */
export const COMFY_TOOL_NAME = 'qqbot_generate_video';
/** UI 工作流或已是 API 格式的图，统一取成 API graph */
export function toApiGraph(workflow, overrides = {}) {
    if (Array.isArray(workflow?.nodes))
        return workflowToApi(workflow, overrides);
    // 已是 API 格式（节点 id → {class_type, inputs}）
    const graph = structuredClone(workflow);
    const outputId = Object.keys(graph).find((id) => ['SaveImage', 'VHS_VideoCombine', 'SaveVideo'].includes(graph[id]?.class_type));
    if (!outputId)
        throw new Error('工作流里找不到输出节点（SaveImage / VHS_VideoCombine / SaveVideo）');
    return { graph, outputId };
}
/** 订阅 ComfyUI 的生成进度（WebSocket），回调 0-1；环境不支持时返回 undefined
 *  注意：ComfyUI 只把 progress 推给提交任务时的 client_id，因此必须与 /prompt 用同一个 id。
 */
export function watchProgress(baseUrl, promptId, onProgress, clientId) {
    if (typeof WebSocket !== 'function')
        return undefined;
    const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId ?? promptId)}`;
    let ws;
    try {
        ws = new WebSocket(wsUrl);
    }
    catch {
        return undefined;
    }
    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg?.type !== 'progress')
                return;
            const data = msg.data ?? {};
            if (data.prompt_id && data.prompt_id !== promptId)
                return;
            const max = Number(data.max) || 0;
            if (max <= 0)
                return;
            onProgress(Math.max(0, Math.min(1, Number(data.value) / max)));
        }
        catch {
            // 忽略非 JSON / 异常消息
        }
    };
    return {
        close: () => {
            try {
                ws.close();
            }
            catch {
                // ignore
            }
        },
    };
}
/** 让 ComfyUI 卸载模型、释放显存 */
export async function freeComfyMemory(baseUrl) {
    try {
        const res = await fetch(`${baseUrl}/free`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ unload_models: true, free_memory: true }),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
/** 切换任务类型（image / video）时先释放显存，避免两套模型挤爆 24GB */
let lastKind = '';
/**
 * 生成前确保有足够显存。
 *
 * ComfyUI 会把模型缓存在显存里不归还（实测缓存能占到 19GB），
 * 新任务申请不到时 ROCm 会抛 `unspecified launch failure` 而不是干净的 OOM。
 * 所以：切换任务类型、或可用显存低于阈值时，主动 /free 再提交。
 */
export async function prepareKind(baseUrl, kind, logger) {
    const needGB = kind === 'video' ? 20 : 14;
    let freeGB;
    try {
        const res = await fetch(`${baseUrl}/system_stats`);
        if (res.ok) {
            const stats = await res.json();
            const device = stats?.devices?.[0];
            if (device?.vram_free) {
                freeGB = device.vram_free / (1024 ** 3);
            }
        }
    }
    catch {
        // 取不到就按需要清理处理
    }
    const switched = lastKind !== '' && lastKind !== kind;
    const low = freeGB !== undefined && freeGB < needGB;
    if (switched || low) {
        logger?.info?.(`im-qqbot: ComfyUI 释放显存（${lastKind || '?'} → ${kind}，free=${freeGB?.toFixed(1) ?? '?'}GB，need=${needGB}GB）`);
        await freeComfyMemory(baseUrl);
        await new Promise((r) => setTimeout(r, 1500));
    }
    lastKind = kind;
}
/**
 * 提交并等待；遇到 CUDA/HIP 显存类错误时清理一次再重试。
 * 返回 { promptId, entry }。
 */
export async function runGraph(baseUrl, graph, options) {
    const run = async (retry) => {
        if (retry) {
            await freeComfyMemory(baseUrl);
            await new Promise((r) => setTimeout(r, 2000));
        }
        const promptId = await submitPrompt(baseUrl, graph, options.clientId);
        const watcher = watchProgress(baseUrl, promptId, options.onProgress, options.clientId);
        try {
            const entry = await waitForOutput(baseUrl, promptId, {
                timeoutMs: options.timeoutMs,
                intervalMs: options.intervalMs,
            });
            return { promptId, entry };
        }
        finally {
            watcher?.close();
        }
    };
    try {
        return await run(false);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/(CUDA|HIP|out of memory|alloc|launch failure)/i.test(message))
            throw err;
        await options.onRetry?.(message);
        return run(true);
    }
}
/** 从 history 里取出全部产物 */
export function pickOutputs(entry, keys) {
    const items = [];
    for (const node of Object.values(entry?.outputs ?? {})) {
        for (const key of keys) {
            for (const item of node?.[key] ?? [])
                items.push(item);
        }
    }
    return items;
}
/**
 * 图片工作流：文生图 / 图生图一键切换。
 *
 * 约定（对应 Z-Image-Turbo 三视图工作流）：
 * - `PrimitiveBoolean` = 模式开关（false 文生图 / true 图生图）
 * - `LoadImage.image` = 参考图（图生图时上传后写入）
 * - `EmptySD3LatentImage` / `ImageScale` = 分辨率
 * - `KSampler.seed` 每次随机
 */
export function buildImageGraph(workflow, options) {
    const { graph, outputId } = toApiGraph(workflow);
    const nodes = Object.values(graph);
    const find = (...types) => nodes.find((n) => types.includes(n.class_type));
    const sampler = find('KSampler', 'KSamplerAdvanced');
    // 只改正向提示词（KSampler.positive 指向的那个 CLIPTextEncode）
    const positiveId = sampler?.inputs?.positive?.[0];
    if (positiveId && graph[positiveId]?.inputs)
        graph[positiveId].inputs.text = options.prompt;
    else {
        const encode = find('CLIPTextEncode');
        if (encode)
            encode.inputs.text = options.prompt;
    }
    for (const node of nodes) {
        if (node.class_type === 'EmptySD3LatentImage' || node.class_type === 'EmptyLatentImage') {
            node.inputs.width = options.size;
            node.inputs.height = options.size;
        }
        if (node.class_type === 'ImageScale') {
            node.inputs.width = options.size;
            node.inputs.height = options.size;
        }
        if (node.class_type === 'PrimitiveBoolean')
            node.inputs.value = Boolean(options.image);
    }
    if (options.image) {
        const loader = find('LoadImage');
        if (loader)
            loader.inputs.image = options.image;
    }
    if (sampler)
        sampler.inputs.seed = Math.floor(Math.random() * 1e15);
    return { graph, outputId };
}

/** 注册图片生成工具 */
export function registerImageTool(ctx, io, manager, config, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-qqbot: tools 服务不可用，qqbot_generate_image 工具未注册');
        return;
    }
    const cfg = config.comfyui ?? {};
    const baseUrl = String(cfg.baseUrl ?? 'http://127.0.0.1:8188').replace(/\/+$/, '');
    try {
        const file = assertWorkflowPath(cfg.imageWorkflow, config);
        if (!existsSync(file))
            throw new Error(`文件不存在: ${file}`);
        logger.info?.(`im-qqbot: ComfyUI 图片工作流 = ${file}`);
    }
    catch (err) {
        logger.error?.(`im-qqbot: 图片工具未注册 —— ${err instanceof Error ? err.message : String(err)}`);
        return;
    }
    tools.register({
        name: 'qqbot_generate_image',
        description: 'Generate an image with the local ComfyUI Z-Image-Turbo workflow and send it to the current QQ conversation. '
            + 'Use for pictures, portraits, character sheets / three-view sheets, illustrations. '
            + 'If the user attached or referenced an image, pass its local path as reference_image to run image-to-image; '
            + 'otherwise it runs text-to-image. quality is 0-1 (0.5 default, 1 = 1024px).',
        parameters: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'Image prompt (what to draw). Chinese or English both fine.' },
                quality: { type: 'number', description: 'Render quality 0-1 (default 0.5, 1 = 1024px).', minimum: 0, maximum: 1 },
                reference_image: { type: 'string', description: 'Optional local path of an image for image-to-image (inside allowed folders).' },
            },
            required: ['prompt'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    count: { type: 'integer' },
                    size: { type: 'integer' },
                    quality: { type: 'number' },
                    elapsedMs: { type: 'number' },
                },
                required: ['count', 'size', 'quality', 'elapsedMs'],
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: `已生成并发送 ${value.count} 张图（${value.size}px / 画质 ${value.quality}）` }],
        },
        async execute(args, exec) {
            const record = exec?.agent !== undefined ? manager.findByAgent(exec.agent) : undefined;
            if (!record)
                throw new Error('qqbot_generate_image: 无法定位当前 QQ 会话');
            const rawQuality = Number(args.quality);
            const quality = Math.max(0, Math.min(1, Number.isFinite(rawQuality) ? rawQuality : Number(cfg.defaultQuality ?? 0.5)));
            // 画质 → 分辨率：0.5 → 768，1.0 → 1024，最低 512，按 64 对齐
            const size = Math.max(512, Math.min(1024, Math.round((512 + 512 * quality) / 64) * 64));
            const startedAt = Date.now();
            const notify = async (text) => {
                try {
                    await io.text.sendMarkdown(record.replyTarget, text);
                }
                catch (err) {
                    logger.warn(`im-qqbot: image 进度发送失败: ${err instanceof Error ? err.message : String(err)}`);
                }
            };
            let imageName;
            if (typeof args.reference_image === 'string' && args.reference_image.trim() !== '') {
                const refPath = assertPathAllowed(args.reference_image, config, 'reference_image');
                if (!existsSync(refPath))
                    throw new Error(`参考图不存在: ${refPath}`);
                imageName = await uploadImage(baseUrl, readFileSync(refPath), basename(refPath));
            }
            const workflow = loadWorkflow({ comfyui: { workflow: cfg.imageWorkflow } }, logger);
            const { graph } = buildImageGraph(workflow, { prompt: String(args.prompt ?? ''), size, image: imageName });
            const problems = await fillRequiredDefaults(baseUrl, graph);
            if (problems.length > 0)
                throw new Error(`图片工作流参数校验失败: ${problems.join('; ')}`);
            const at = cfg.mentionSender !== false ? `<@${record.senderId}> ` : '';
            await prepareKind(baseUrl, 'image', logger);
            await notify(`${at}${imageName ? '图生图中' : '绘画中'}…`);
            const clientId = crypto.randomUUID();
            // 进度到一半时 @ 一次，让用户等；CUDA/显存错误会自动清理重试一次
            let halfway = false;
            const { promptId, entry } = await runGraph(baseUrl, graph, {
                clientId,
                timeoutMs: Number(cfg.imageTimeoutMs ?? 180000),
                intervalMs: 1500,
                onProgress: (pct) => {
                    if (!halfway && pct >= 0.5) {
                        halfway = true;
                        void notify(`${at}还在画，再等一下…`);
                    }
                },
                onRetry: async () => {
                    await notify(`${at}显存不够，清理后重试…`);
                },
            });
            const items = pickOutputs(entry, ['images']);
            if (items.length === 0)
                throw new Error('ComfyUI 已结束但没有图片产物');
            const tmpDir = resolve(String(cfg.outputDir ?? 'D:/QQat/.comfy-tmp'));
            mkdirSync(tmpDir, { recursive: true });
            let sent = 0;
            try {
                for (const item of items.slice(0, 4)) {
                    const dest = join(tmpDir, `${promptId}-${sent}${extname(item.filename) || '.png'}`);
                    await downloadOutput(baseUrl, item, dest);
                    assertPathAllowed(dest, config, 'output');
                    await io.media.sendImage(record.replyTarget, { localPath: dest });
                    sent += 1;
                    try {
                        unlinkSync(dest);
                    }
                    catch {
                        // ignore
                    }
                }
                await notify(`${at}画好了`);
            }
            finally {
                // 清理可能残留的临时文件
            }
            return { count: sent, size, quality, elapsedMs: Date.now() - startedAt };
        },
    });
    logger.info('im-qqbot: qqbot_generate_image 工具已注册');
}

export function registerComfyTool(ctx, io, manager, config, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-qqbot: tools 服务不可用，qqbot_generate_video 工具未注册');
        return;
    }
    const cfg = config.comfyui ?? {};
    const baseUrl = String(cfg.baseUrl ?? 'http://127.0.0.1:8188').replace(/\/+$/, '');
    // 工作流硬约束：必须存在、且只能放在 D:\QQat 内
    try {
        const file = assertWorkflowPath(cfg.workflow, config);
        if (!existsSync(file))
            throw new Error(`文件不存在: ${file}`);
        logger.info?.(`im-qqbot: ComfyUI 工作流 = ${file}（按工作流的 bypass 状态执行，默认一采）`);
    }
    catch (err) {
        logger.error?.(`im-qqbot: ComfyUI 工具未注册 —— ${err instanceof Error ? err.message : String(err)}`);
        return;
    }
    tools.register({
        name: COMFY_TOOL_NAME,
        description: 'Generate a short video (with audio) from a text prompt using the local ComfyUI MiniMax-H3 workflow, '
            + 'then send it to the current QQ conversation. Use when someone asks for a video / animation / "动起来". '
            + 'For still pictures use qqbot_generate_image instead. '
            + 'The prompt MUST follow the MiniMax format: [camera move] + subject & action + scene & lighting + sound + duration. '
            + 'Keep clips at or under 10 seconds; quality is 0-1 (0.5 default, never above 1). '
            + 'If the user attached a reference image, pass its local path so it can be used as <Picture 1>.',
        parameters: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: `Video prompt in MiniMax format. ${MINIMAX_FORMAT_HINT}` },
                seconds: { type: 'number', description: 'Clip length in seconds (1-10, default 5).', minimum: 1, maximum: 10 },
                quality: { type: 'number', description: 'Render quality 0-1 (default 0.5, max 1).', minimum: 0, maximum: 1 },
                reference_image: { type: 'string', description: 'Optional local path of an image to use as <Picture 1> (must be inside the allowed folders).' },
            },
            required: ['prompt'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    fileName: { type: 'string' },
                    seconds: { type: 'number' },
                    quality: { type: 'number' },
                    elapsedMs: { type: 'number' },
                },
                required: ['fileName', 'seconds', 'quality', 'elapsedMs'],
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: `已生成并发送 ${value.fileName}（${value.seconds}s / 画质 ${value.quality}）` }],
        },
        async execute(args, exec) {
            const record = exec?.agent !== undefined ? manager.findByAgent(exec.agent) : undefined;
            if (!record) {
                throw new Error(`${COMFY_TOOL_NAME}: 无法定位当前 QQ 会话（可能不在 QQ 对话里）`);
            }
            const seconds = Math.max(1, Math.min(Number(cfg.maxSeconds ?? 10), Number(args.seconds) || Number(cfg.defaultSeconds ?? 5)));
            const rawQuality = Number(args.quality);
            const quality = Math.max(0, Math.min(Number(cfg.maxQuality ?? 1), Number.isFinite(rawQuality) ? rawQuality : Number(cfg.defaultQuality ?? 0.5)));
            const megapixels = Math.max(0.1, Math.min(1, quality));
            const startedAt = Date.now();
            const notify = async (text) => {
                try {
                    await io.text.sendMarkdown(record.replyTarget, text);
                }
                catch (err) {
                    logger.warn(`im-qqbot: comfy 进度发送失败: ${err instanceof Error ? err.message : String(err)}`);
                }
            };
            // 1. 准备参考图
            let imageName;
            if (typeof args.reference_image === 'string' && args.reference_image.trim() !== '') {
                const refPath = assertPathAllowed(args.reference_image, config, 'reference_image');
                if (!existsSync(refPath))
                    throw new Error(`参考图不存在: ${refPath}`);
                imageName = await uploadImage(baseUrl, readFileSync(refPath), basename(refPath));
            }
            // 2. 构建并提交（工作流只在内存中转换）
            const workflow = loadWorkflow(config, logger);
            const { graph } = workflowToApi(workflow, {
                prompt: String(args.prompt ?? ''),
                seconds,
                megapixels,
                image: imageName,
            });
            const problems = await fillRequiredDefaults(baseUrl, graph);
            if (problems.length > 0)
                throw new Error(`工作流参数校验失败: ${problems.join('; ')}`);
            const at = cfg.mentionSender !== false ? `<@${record.senderId}> ` : '';
            await prepareKind(baseUrl, 'video', logger);
            await notify(`${at}生成中…（${seconds}s 视频）`);
            const clientId = crypto.randomUUID();
            // 进度过半时 @ 一次；CUDA/显存错误自动清理重试
            let halfway = false;
            const { promptId, entry } = await runGraph(baseUrl, graph, {
                clientId,
                timeoutMs: Number(cfg.timeoutMs ?? 15 * 60 * 1000),
                intervalMs: 2500,
                onProgress: (pct) => {
                    if (!halfway && pct >= 0.5) {
                        halfway = true;
                        void notify(`${at}还在生成，再等一下…`);
                    }
                },
                onRetry: async () => {
                    await notify(`${at}显存不够，清理后重试…`);
                },
            });
            const item = pickOutput(entry);
            if (!item)
                throw new Error('ComfyUI 已结束但没有产物');
            // 4. 下载到临时目录 → 发送 → 删除
            const tmpDir = resolve(String(cfg.outputDir ?? 'D:/QQat/.comfy-tmp'));
            const ext = extname(item.filename) || '.mp4';
            const dest = join(tmpDir, `${promptId}${ext}`);
            await downloadOutput(baseUrl, item, dest);
            assertPathAllowed(dest, config, 'output');
            try {
                await io.media.sendVideo(record.replyTarget, { localPath: dest });
                await notify(`${at}视频好了 · ${seconds}s · 画质 ${quality}`);
            }
            finally {
                try {
                    unlinkSync(dest);
                }
                catch {
                    // 删除失败忽略
                }
            }
            return {
                fileName: basename(dest),
                seconds,
                quality,
                elapsedMs: Date.now() - startedAt,
            };
        },
    });
    logger.info(`im-qqbot: ${COMFY_TOOL_NAME} 工具已注册（${baseUrl}）`);
}
//# sourceMappingURL=comfyui.js.map
