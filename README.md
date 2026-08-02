# Home Aid Intake Portal

无障碍法律援助预申请与工作人员接续系统。基于 Next.js App Router、TypeScript strict、Prisma 和 SQLite 构建。

## 快速开始

```bash
npm install
npx prisma db push
npx prisma generate
npm run prisma:seed
npm run dev
```

打开 http://localhost:3000

## 验证命令

```bash
npm test              # 单元测试 (vitest, 46 tests)
npm run build         # 生产构建 (含 prisma generate + next build + tsc)
npm run dev           # 开发服务器
npm run test:e2e      # Playwright E2E 测试 (需先 npm run test:e2e:install)
```

## 状态机

```
DRAFT ──submit──► SUBMITTED ──┬── request_correction ──► NEEDS_CORRECTION
                               ├── accept ──► ACCEPTED
                               └── decline ──► DECLINED

NEEDS_CORRECTION ──resubmit──► RESUBMITTED ──┬── request_correction ──► NEEDS_CORRECTION
                                              ├── accept ──► ACCEPTED
                                              └── decline ──► DECLINED
```

- **DRAFT**: 草稿，申请人可编辑
- **SUBMITTED**: 已提交，等待工作人员初审
- **NEEDS_CORRECTION**: 需要补正，申请人可编辑后重新提交
- **RESUBMITTED**: 已重新提交，等待工作人员再次审核
- **ACCEPTED**: 已受理（终态）
- **DECLINED**: 已拒绝（终态）

非法转换会被服务端拒绝并返回 403。只有 `DRAFT` 和 `NEEDS_CORRECTION` 状态允许编辑草稿。

## 材料规则

| 豁免原因 | 经济困难证明 | 身份证明 | 其他材料 |
|---------|:----------:|:------:|:------:|
| `NONE` | 必填 | 必填 | 必填 |
| `NO_FIXED_INCOME` | **豁免** | 必填 | 必填 |
| `NOTIFIED_CRIMINAL_DEFENSE` | 必填 | 必填 | 必填 |

选择 `NO_FIXED_INCOME` 后，经济困难证明上传控件被禁用，服务端校验也跳过该字段。但身份证明和其他材料仍为必填。

## 字段级信息披露

工作人员界面采用最小披露原则，根据申请状态自动切换视图：

### INTAKE_REVIEW 视图（SUBMITTED / RESUBMITTED）
可见字段：`id`, `state`, `exemptionReason`, `idDocumentMeta`, `otherMaterialMeta`, `accommodations`, `legalIssueType`

**不可见**：申请人姓名、联系电话、邮箱、案件描述、经济困难证明详情。

### CORRECTION_REVIEW 视图（NEEDS_CORRECTION）
可见字段：上述全部 + `fullName`, `contactPhone`, `contactEmail`, `caseDescription`, `economicProofMeta`, 以及待补正字段列表。

## 草稿冲突解决

### 版本控制
- 每个 Application 有 `version` 字段，每次成功保存自增
- 客户端保存时携带 `baseVersion`（上次同步时的服务器版本）
- 服务端检测 `baseVersion < currentVersion` 时返回 409 Conflict

### 字段级合并规则
1. **相同版本**：客户端数据直接覆盖
2. **旧版本冲突**：逐字段比较
   - 值相同：无冲突
   - 客户端为空而服务端有值：服务端胜出（防止旧草稿清空新数据）
   - 服务端为空而客户端有值：客户端胜出（补充数据）
   - 双方都有不同值：客户端胜出，记录冲突字段
3. **保护字段（accommodations）**：数组合并去重，永不覆盖。服务端和客户端的合理便利需求都会保留

### 客户端字段白名单
客户端只能修改以下字段：`fullName`, `contactPhone`, `contactEmail`, `caseDescription`, `legalIssueType`, `exemptionReason`, `accommodations`, `economicProofMeta`, `idDocumentMeta`, `otherMaterialMeta`。`state`, `version`, `idempotencyKey` 等字段被过滤，防止越权。

## 幂等提交

提交时需提供 `idempotencyKey`。服务端记录该 key：
- 相同 key 重复提交：返回已有结果，不重复执行
- 已提交状态再次提交：返回当前状态，不报错
- 网络重试不会产生重复申请

## 离线草稿恢复

- 每次字段变更后 2 秒自动保存到 `localStorage`（key: `legal-aid-draft-{id}`）
- 离线时显示横幅提示，数据保存在本地
- 恢复联网后自动同步
- 重新加载页面时，合并本地草稿与服务器数据，保护字段（合理便利）做并集合并

## 无障碍特性

- 所有控件有 `<label>` 或 `aria-label`，`name` 属性可被程序识别
- 错误信息通过 `aria-describedby` 关联到对应字段，`aria-invalid="true"` 标记
- 验证失败时焦点自动移到第一个错误字段
- 步骤切换时 ARIA live region 公告当前步骤和错误数量
- 状态徽章同时使用颜色、图标和文字（非颜色单一表达）
- 完整键盘导航支持（Tab/Enter/Space/箭头键）
- 跳转链接（skip to main content）
- `prefers-reduced-motion` 支持
- 文件上传控件可通过键盘操作

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/applications` | 列出所有申请 |
| POST | `/api/applications` | 创建申请（幂等，id 存在则返回已有） |
| GET | `/api/applications/[id]` | 获取申请详情 |
| PUT | `/api/applications/[id]` | 保存草稿（需 version，409 时返回合并结果） |
| POST | `/api/applications/[id]/submit` | 提交申请（需 idempotencyKey） |
| GET | `/api/applications/[id]/corrections` | 获取补正记录 |
| POST | `/api/applications/[id]/corrections` | 工作人员发起补正 |
| POST | `/api/applications/[id]/decision` | 工作人员受理/拒绝 |
| GET | `/api/staff/applications` | 工作人员列表（最小披露） |

## 种子数据

- **APP-201**: `NO_FIXED_INCOME` 豁免，含 `HOME_VISIT_NEEDED` 合理便利，DRAFT 状态
- **APP-202**: `NONE`（无豁免），含 `TEXT_ONLY` 合理便利，NEEDS_CORRECTION 状态（经济困难证明待补正）

## 项目结构

```
src/
  domain/           # 核心业务逻辑（纯函数，无框架依赖）
    types.ts        # 类型定义
    state-machine.ts# 状态机
    validation.ts   # 服务端校验
    conflict.ts     # 字段级冲突合并
  lib/              # 基础设施
    prisma.ts       # Prisma 客户端单例
    serializers.ts  # 数据库模型 -> 领域模型
    api-response.ts # 统一响应格式
  app/
    api/            # API 路由
    apply/[id]/     # 申请人表单页
    staff/          # 工作人员页面
    page.tsx        # 首页
  components/       # React 组件
  hooks/            # useDraft 等客户端 hooks
e2e/                # Playwright E2E 测试
prisma/
  schema.prisma     # 数据模型
  seed.ts           # 种子脚本
```

## E2E 验收测试覆盖

- 键盘完整填写流程
- 屏幕阅读器公告（步骤切换、错误提示）
- 错误焦点恢复
- 离线草稿保存与恢复
- 合理便利需求在离线/在线循环中保留
- 双会话字段级合并冲突
- 旧草稿不能清除合理便利
- 重复提交幂等性
- 补正流程（工作人员发起 → 申请人看到 → 重新提交）
- 工作人员最小披露（列表页和详情页）
- 状态机非法转换被拒
