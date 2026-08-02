# Home Aid Intake Portal

Accessible legal-aid pre-application and staff continuation flow.

技术栈：Next.js App Router、TypeScript strict、Prisma、SQLite。未引入整套 UI 组件库；
表单控件为原生 HTML + 手写可访问性样式（`src/app/globals.css`）。

## 快速开始

```bash
npm install          # 安装依赖并生成 Prisma Client
npm run db:push      # 建库（prisma/dev.db）
npm run db:seed      # 按 materials/application-cases.json 播种 APP-201 / APP-202
npm run dev          # http://localhost:3000
```

## 原生验收

```bash
npm test             # vitest：状态机/校验/合并/披露/幂等服务（含 SQLite 集成）
npm run build        # prisma generate + next build
npm run dev          # 开发服务器
npm run test:e2e     # Playwright 浏览器验收（自动重置并播种 dev.db，端口 3100）
```

## 业务规则

- 经济状况情形为 `NO_FIXED_INCOME`（无固定收入）或 `NOTIFIED_CRIMINAL_DEFENSE`
  （通知辩护）时**免交经济困难证明**；身份证明等其他必要材料规则照常执行
  （见 `src/lib/validation.ts` 的 `requiresEconomicProof` / `validateForSubmit`）。
- 材料只登记元数据（种类、名称、fileName/size/mimeType/uploadedAt），不存文件本体。

## 状态机

`src/lib/state-machine.ts`（单一事实来源，服务端强制执行）：

```
DRAFT ──SUBMIT──▶ SUBMITTED ──REQUEST_CORRECTION──▶ NEEDS_CORRECTION
                    │  ▲                                │ RESUBMIT
                    │  └────────── RESUBMITTED ◀────────┘
                    ├──ACCEPT──▶ ACCEPTED（终态）        ▲
                    └──DECLINE──▶ DECLINED（终态）        │
RESUBMITTED 同样可 REQUEST_CORRECTION / ACCEPT / DECLINE ┘
```

- 提交与重新提交都携带幂等键（`Application.idempotencyKey`，唯一约束）。
  同一幂等键重复提交返回首次结果（HTTP 200 + `duplicate: true`），不重复流转、
  不重复写事件；并发同键提交通过 `updateMany WHERE state='DRAFT'` 乐观抢占，
  恰好一次生效。
- 每次流转写入 `ApplicationEvent` 审计记录。

## 草稿与离线冲突解决

- 客户端每次编辑即时写入 `localStorage`（键 `draft:{applicationId}`，含
  `baseVersion` 与全部字段），断网时状态栏与 `role=status` 公告提示“离线”，
  恢复联网后自动同步。
- 服务端为每个字段记录 `fieldVersions`（字段最后变更版本）。草稿保存
  `PATCH /api/applications/{id}` 携带 `baseVersion`：
  - 值与服务端相同 → 跳过（避免全量上送造成假冲突）；
  - 字段在 `baseVersion` 之后被改过 → 冲突，**服务端值获胜**，随响应
    `conflicts[]` 回传，客户端回退该字段并公告；
  - 其余字段应用并刷新字段版本。
    由此**旧草稿无法清掉已保存的合理便利需求**（`accommodations` 冲突时保留服务端值）。
- 若草稿保存时服务端状态机已前进（如已被受理，409 `DRAFT_LOCKED`），
  客户端拉取全量并整体收敛到服务端状态，清除本地草稿。
- 服务端状态机与客户端缓存只通过 application ID + 乐观版本（`version` /
  `fieldVersions`）收敛，不依赖会话。

## 工作人员最小披露

`src/lib/disclosure.ts` 的 `projectForStaffView` 在服务端响应前裁剪字段，
越权字段不会离开服务器（页面与 API 同一投影函数）：

| 视图                            | 可见字段                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `INTAKE_REVIEW`（受理初审）     | `id`, `state`, `exemptionReason`, `materialMetadata`, `accommodations`                                |
| `CORRECTION_REVIEW`（补正复核） | `id`, `state`, `correctionFields`, `submittedFieldMetadata`（仅 present/length 等元数据，绝无原始值） |

工作人员操作：`POST /api/staff/applications/{id}/transition`
（`REQUEST_CORRECTION` 需 `fields` + `reasonCode`；`ACCEPT` / `DECLINE`）。

## API 一览

| 方法  | 路径                                                                       | 说明                                   |
| ----- | -------------------------------------------------------------------------- | -------------------------------------- |
| POST  | `/api/applications`                                                        | 新建草稿                               |
| GET   | `/api/applications/{id}`                                                   | 申请人读取自有完整申请                 |
| PATCH | `/api/applications/{id}`                                                   | 草稿保存（`baseVersion` + 字段级合并） |
| POST  | `/api/applications/{id}/materials` / DELETE `…/materials/{mid}`            | 材料元数据增删                         |
| POST  | `/api/applications/{id}/submit`                                            | 最终提交（幂等键）                     |
| POST  | `/api/applications/{id}/resubmit`                                          | 补正后重新提交（幂等键）               |
| GET   | `/api/staff/applications[?view=]` / `/api/staff/applications/{id}[?view=]` | 最小披露列表/详情                      |
| POST  | `/api/staff/applications/{id}/transition`                                  | 工作人员状态操作                       |

错误响应统一为 `{ error: { code, message, details } }`；校验失败为
HTTP 422 + `details.fieldErrors`（字段名 → 中文错误说明）。

## 可访问性约定

- 每个控件都有程序化名称（`<label htmlFor>` / `<legend>` / `aria-label`），
  错误通过 `aria-describedby` 关联到 `role="alert"` 的错误节点，并设 `aria-invalid`。
- 焦点恢复：校验失败时焦点移到错误汇总（`role="alert"` + `tabIndex=-1`），
  汇总内链接把焦点送回对应控件；步骤切换后焦点移到步骤标题。
- 屏幕阅读器公告区（`role="status"` + `aria-live="polite"`）播报步骤切换、
  断线/恢复、草稿恢复、冲突回退、提交结果。
- 状态不只靠颜色：符号（◐▶↺⇧✓✕）+ 文字 + 边框样式三者共同表达
  （`src/components/StatusBadge.tsx`）。
- 跳到主要内容链接、键盘可达的全部交互。

## 浏览器验收（e2e）

`npm run test:e2e`（`e2e/`，workers=1，global-setup 自动重置并播种 dev.db）：

| 用例                          | 覆盖                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `offline-draft.spec.ts`       | 离线填写→本机暂存→重开页面恢复并合并，断线公告                                                        |
| `merge-conflict.spec.ts`      | **双浏览器会话**同基线字段级合并冲突（服务端优先、旧草稿不清合理便利）；服务端已受理时客户端整体收敛  |
| `duplicate-submit.spec.ts`    | UI 提交后同键再提交返回首次结果；并发同键双提交恰好一次生效                                           |
| `correction-resubmit.spec.ts` | APP-202 补正提示→材料错误焦点→补交证明→重新提交；`NO_FIXED_INCOME` 免交经济困难证明且其他材料规则照常 |
| `staff-disclosure.spec.ts`    | 两个视图的最小披露（API 键白名单 + 页面无越权值）；受理操作；非颜色状态徽标                           |
| `a11y.spec.ts`                | 错误焦点恢复、控件名称/错误关联、纯键盘第一步、SR 公告区语义、断线恢复公告、跳过链接                  |

种子数据（`prisma/seed.ts`）严格来自 `materials/application-cases.json`：
APP-201（`NO_FIXED_INCOME`，免交证明，已提交）、APP-202（`NONE`，缺经济困难证明，
`NEEDS_CORRECTION` + `ECONOMIC_PROOF_REQUIRED` 补正记录）。
