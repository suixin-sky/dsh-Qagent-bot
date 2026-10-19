# dsh-qqbot 增强版

基于 [@tencent-connect/dsh-qqbot](https://github.com/tencent-connect/dsh-qqbot) 的 QQ 群机器人定制版。
在官方插件基础上增加了群友人设、聊天归档、成员名录、表情包、模型召唤、ComfyUI 图片/视频生成等能力。

> 非官方修改版，与 Tencent Connect 无隶属关系。仓库只包含编译后的 `dist` 代码，不包含 TypeScript 源码。

---

## 功能

- **群聊门控**：@、叫名字、召唤候选、对话延续四种免 @ 方式；普通闲聊不接话
- **对话延续**：机器人说完话后 3 分钟内，用小模型判断新消息是不是在接它的话/笑它
- **聊天归档**：按会话写 `chat.md` + 图片/视频，文本 20 天、媒体 10 天自动清理
- **成员名录**：openid + 名称历史，改昵称也能认人
- **表情包**：按标签发送本地图库表情（图片由使用者自备）
- **模型召唤**：说「叫 XX 上号」切本地模型，「叫 deepseek 回来」切回默认；闲置自动回流
- **按模型人设**：默认模型与本地模型可各用一套人设（人设由使用者自备）
- **ComfyUI**：
  - 文生图 / 图生图（Z-Image-Turbo，一键切换）
  - 文生视频（MiniMax-H3，默认只跑一采）
  - WebSocket 真实进度、50% 时 @ 提醒、完成后发群并 @
  - 显存预检、自动清理与失败重试
- **安全门控**：工具只能访问工作区与 DSH 数据目录，拦截凭据类文件

---

## 仓库结构

```
Qagent/
├─ package.json
├─ dist/                     # 插件代码（编译后 JS）
├─ lib/client.js             # 设置面板前端
├─ templates/
│  ├─ chatlog/               # 归档目录骨架（空白 md + 空文件夹）
│  ├─ personas/README.md     # 人设文件说明（自备）
│  └─ stickers/README.md     # 表情包图库说明（自备）
├─ 源码说明.md               # 模块、链路、机制
├─ 部署说明.md               # 安装、配置、验证、回滚
├─ LICENSE                   # MIT（Tencent Connect）
└─ NOTICE                    # 上游归属与本仓库范围
```

---

## 环境要求

- DeepSeek Harness（dsh）Desktop，profile `desktop`
- Node.js 20.3+
- QQ 机器人 AppID / AppSecret
- 可选：ComfyUI（图片/视频生成）、LM Studio（本地模型召唤）

---

## 快速开始

完整步骤见 [部署说明.md](部署说明.md)，核心三步：

1. 把 `dist/`、`lib/`、`package.json` 覆盖到插件目录
2. 编辑 `cordis.patch.yml`，填入 AppID/AppSecret 与各项配置
3. 保存触发重载，按验证清单逐项确认

人设与表情包需要自行添加，见：

- [templates/personas/README.md](templates/personas/README.md)
- [templates/stickers/README.md](templates/stickers/README.md)

归档目录骨架可以复制到 `D:\QQat\chatlog` 直接使用。

---

## 本仓库不包含

| 内容 | 原因 |
|---|---|
| 人设提示词 | 第三方创作，未获再分发授权；请自备 |
| 表情包图片 | 来源与授权不明确；请自备 |
| ComfyUI 工作流 | 与具体模型/显卡相关，请自备 |
| 聊天记录 / 成员数据 | 运行时数据，不应入库 |
| AppID / AppSecret | 凭据 |

---

## 实现说明

- 消息链、门控、归档、召唤、人设、ComfyUI 的实现细节见 [源码说明.md](源码说明.md)
- 本仓库直接修改的是 `dist/*.js`；官方包升级会覆盖这些改动，升级后需要重新应用
- 默认路径按 `D:\QQat` 设计（归档、表情包、工作流、临时产物），可通过配置修改

---

## 许可

上游代码：MIT License, Copyright (c) 2026 Tencent Connect，全文见 [LICENSE](LICENSE)。
本仓库的修改部分同样以 MIT 发布。详见 [NOTICE](NOTICE)。

## 免责声明

本项目仅供学习与自用。使用前请遵守 QQ 开放平台规范及所在地法律法规；由使用者自行承担部署、内容与合规责任。
