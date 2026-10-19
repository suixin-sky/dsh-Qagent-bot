/**
 * 扫码 URL → SVG data URL（宿主侧渲染）
 *
 * 二维码图像在宿主生成而非浏览器：客户端 bundle 保持零第三方依赖
 * （externals 仅平台种子表），且二维码由可信源编码，页面无伪造面。
 */
import QRCode from 'qrcode';
/** 二维码渲染参数（输出 SVG，含 1 单位留白，240px 宽度适合侧栏展示） */
const QR_OPTIONS = { type: 'svg', margin: 1, width: 240 };
/**
 * 将绑定 URL 渲染为 SVG data URL，供端内绑定页 <img> 直接使用。
 *
 * @param url - 二维码内容（q.qq.com 的 connect.html 链接）
 * @returns `data:image/svg+xml;base64,...` 形式的 data URL
 */
export async function renderQrSvgDataUrl(url) {
    const svg = await QRCode.toString(url, QR_OPTIONS);
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
//# sourceMappingURL=qr-svg.js.map