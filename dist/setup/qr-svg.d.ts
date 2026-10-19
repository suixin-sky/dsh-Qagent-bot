/**
 * 将绑定 URL 渲染为 SVG data URL，供端内绑定页 <img> 直接使用。
 *
 * @param url - 二维码内容（q.qq.com 的 connect.html 链接）
 * @returns `data:image/svg+xml;base64,...` 形式的 data URL
 */
export declare function renderQrSvgDataUrl(url: string): Promise<string>;
//# sourceMappingURL=qr-svg.d.ts.map