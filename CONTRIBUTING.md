# Contributing

Thanks for your interest. This repository is a **modified build** of
[`@tencent-connect/dsh-qqbot`](https://github.com/tencent-connect/dsh-qqbot):
it ships compiled `dist/*.js` rather than TypeScript sources, so please read the
constraints below before opening a PR.

## Before you start

- This is an unofficial fork. Upstream issues belong to
  [tencent-connect/dsh-qqbot](https://github.com/tencent-connect/dsh-qqbot).
- Runtime data (chat logs, personas, sticker images, ComfyUI workflows, credentials)
  must **never** be committed. See `.gitignore`.
- Everything here is MIT-licensed; by contributing you agree to license your
  changes under the same terms.

## Reporting issues

Please include:

1. dsh version and desktop/CLI mode
2. Plugin version (`package.json`) and what you changed locally
3. A minimal reproduction: which message triggered it, expected vs. actual
4. Relevant config **with `appId` / `appSecret` removed**
5. Logs with personal data removed (no openids, no message content)

## Pull requests

Keep changes focused. A PR should do one thing and explain why.

Checklist:

- [ ] Behaviour is described (what changes, which config keys are involved)
- [ ] New config keys are added to **both** `dist/config.js` and `dist/config.d.ts`
- [ ] Paths are configurable; do not hardcode a machine-specific directory
- [ ] No credentials, chat logs, openids, personas, stickers or workflows included
- [ ] Manual verification listed (which of the checks in `部署说明.md` you ran)
- [ ] Documentation updated (`README.md`, `源码说明.md`, `部署说明.md` as needed)

Because the repo has no test suite or build step, review is manual. A short
"how I tested it" section matters more than a large diff.

## Adding a feature module

1. Put the implementation under `dist/features/<name>.js` (ESM, no build step).
2. Wire it in `dist/gateway/bootstrap.js` (tools/lifecycle) or
   `dist/gateway/middleware-setup.js` (message chain), respecting the existing
   middleware order.
3. If it needs configuration, add a schema group in `dist/config.js` and mirror
   the type in `dist/config.d.ts`, with Chinese descriptions in the style of the
   existing keys.
4. If it is model-facing, write the tool description so the model knows **when**
   to use it, and keep the parameter set minimal.
5. If it touches the filesystem, route path checks through
   `features/security.js` instead of reading arbitrary paths.

## Style

- ESM only, Node 20+.
- Comments in Chinese, matching the surrounding code.
- Prefer small, explicit functions; no new runtime dependencies unless necessary.
- Never `console.log` secrets; log identifiers at most.

## Security

Please report security issues privately (open a draft advisory or contact the
maintainer) rather than in a public issue. Do not include real credentials or
personal data in reports.
