## 1. Skill 源文件迁入

- [x] 1.1 在 OpenSpec 项目根目录创建 `skills/` 目录
- [x] 1.2 将 gstack 的 25+ skill 目录（每个含 SKILL.md.tmpl + SKILL.md）复制到 `skills/` 下，保持原有目录名
- [x] 1.3 将 gstack 根目录的 SKILL.md.tmpl 和 SKILL.md（主入口 skill）迁入 `skills/` 作为索引
- [x] 1.4 将 gstack 的 `ETHOS.md`、`BROWSER.md`、`AGENTS.md`、`ARCHITECTURE.md` 迁入 `skills/docs/` 作为 skill 参考文档
- [x] 1.5 批量替换所有 SKILL.md.tmpl 和 SKILL.md 中的路径引用：`~/.gstack/` → `~/.openspec/`，`.gstack/` → `.openspec/`
- [x] 1.6 用 grep 验证所有 skill 文件中不再有 `~/.gstack/` 或 `.gstack/` 路径引用

## 2. Browse 浏览器工具链迁入

- [x] 2.1 将 gstack 的 `browse/` 目录（src/ + dist/ + test/）整体复制到 OpenSpec 的 `browse/` 目录
- [x] 2.2 更新 browse 源码中的路径引用（如有指向 gstack 根目录的相对路径）
- [x] 2.3 在 OpenSpec 的 `package.json` 中添加 Playwright 作为 optionalDependencies
- [x] 2.4 在 OpenSpec 的 `package.json` 中添加 browse 相关的 bin 和 `bun build --compile` 构建脚本
- [x] 2.5 验证 browse CLI 在 OpenSpec 目录结构下正常构建和执行

## 3. 构建工具链迁入

- [x] 3.1 将 gstack 的 `scripts/gen-skill-docs.ts` 迁入 OpenSpec 的 `scripts/` 目录
- [x] 3.2 适配 gen-skill-docs.ts 中的路径：skill 扫描目录从 gstack 根目录改为 `skills/`
- [x] 3.3 在 OpenSpec 的 `package.json` 中添加 `gen:skill-docs` 构建脚本
- [x] 3.4 在 OpenSpec 的 `build.js` 中集成 skill 模板生成步骤（gen-skill-docs 在 TypeScript 编译前运行）
- [x] 3.5 将 gstack 的 `scripts/skill-check.ts` 和 `scripts/dev-skill.ts` 迁入并适配路径
- [x] 3.6 验证完整构建链：gen-skill-docs → tsc → browse compile 均成功

## 4. TypeScript 专家模板体系

- [x] 4.1 创建 `src/core/templates/experts/` 目录
- [x] 4.2 为每个迁入的 gstack skill 创建对应的 TypeScript 模板函数文件（如 `review.ts` → `getReviewSkillTemplate(): SkillTemplate`），读取 `skills/<name>/SKILL.md` 内容作为 instructions
- [x] 4.3 创建 `src/core/templates/experts/index.ts` 汇总导出所有专家模板函数
- [x] 4.4 扩展 `src/core/templates/skill-templates.ts`，同时导出 `workflows/` 和 `experts/` 的模板
- [x] 4.5 扩展 `src/core/shared/skill-generation.ts` 的 `getSkillTemplates()` 注册表，新增 25+ 条 `{ template: getXxxSkillTemplate(), dirName: 'openspec-xxx', workflowId: 'xxx' }` 条目
- [x] 4.6 扩展 `getSkillTemplates()` 的过滤逻辑：专家 skill 不受 workflowFilter 影响（默认全部安装）
- [x] 4.7 验证 `openspec init` 能在目标 AI 工具目录中生成所有专家 skill 的 SKILL.md 文件

## 5. Schema 系统扩展

- [x] 5.1 在 `src/core/artifact-graph/schema.ts` 的 ArtifactYamlSchema 中新增 `enhance: z.string().optional()`、`provider: z.string().optional()`、`context-from: z.string().optional()` 三个可选字段
- [x] 5.2 新增 `context-from` 引用校验：引用的 artifact ID 必须存在且在 `requires` 列表中
- [x] 5.3 更新 Artifact 类型定义，新增三个可选字段
- [x] 5.4 升级默认 `schemas/spec-driven/schema.yaml`：version 升为 2，为 proposal/specs/design 添加 `enhance` 字段
- [x] 5.5 编写 schema 扩展的单元测试

## 6. 项目配置扩展

- [x] 6.1 在 `src/core/project-config.ts` 的配置 schema 中新增 `quality-rules: z.array(z.string()).optional()` 字段
- [x] 6.2 在弹性解析逻辑中添加 `quality-rules` 字段的验证和解析
- [x] 6.3 编写 config 扩展的单元测试

## 7. instruction-loader 扩展

- [x] 7.1 读取项目配置的 `quality-rules` 字段，非空时生成 `<quality-rules>` 注入块，插入到 `<rules>` 之后
- [x] 7.2 当 artifact 有 `enhance` 字段时，生成 `<enhance>` 注入块，包含内置 skill 名称和增强指引
- [x] 7.3 当 artifact 有 `provider` 字段时，生成 `<provider>` 注入块，包含内置 skill 名称和调用指引
- [x] 7.4 当 artifact 有 `context-from` 字段且引用的 artifact 已完成时，解析引用 artifact 内容并注入 `<structured-context>` 块
- [x] 7.5 在 `openspec instructions --json` 输出中包含 `enhance`、`provider`、`context-from` 字段
- [x] 7.6 编写 instruction-loader 扩展的单元测试

## 8. Spec 场景解析器

- [x] 8.1 在 `src/core/parsers/requirement-blocks.ts` 中定义 `TestCase` 和 `TestPlan` 接口
- [x] 8.2 实现 `parseTestPlan(specContent: string): TestPlan` 函数：从 `#### Scenario:` 块提取 GIVEN/WHEN/THEN/AND 行
- [x] 8.3 实现 `parseTestPlanFromFiles(specPaths: string[]): TestPlan` 多文件聚合函数
- [x] 8.4 在 instruction-loader 的 `context-from` 处理中集成场景解析器（当引用 specs artifact 时）
- [x] 8.5 编写场景解析器的单元测试

## 9. Archive 质量捕获

- [x] 9.1 在 `src/core/archive.ts` 中新增质量工件扫描：使用 `path.basename()` 检查文件名匹配 `*-review.md`、`*-report.md`、`*-audit.md`
- [x] 9.2 实现质量摘要提取：从质量工件内容中提取关键指标
- [x] 9.3 实现归档元数据写入：`.openspec.yaml` 添加 `quality` 键
- [x] 9.4 实现 `[RULE]` 标记提取和 config.yaml `quality-rules` 自动追加（去重）
- [x] 9.5 在 archive 输出摘要中显示质量数据
- [x] 9.6 编写 archive 质量捕获的单元测试

## 10. 集成测试与验证

- [x] 10.1 验证 `openspec init` 同时生成工作流 skill 和专家 skill 的 SKILL.md 文件
- [x] 10.2 验证默认 `spec-driven` schema v2 的 enhance 字段在 `openspec instructions` 中正确输出
- [x] 10.3 创建一个含 provider 和 context-from 的自定义测试 schema，验证端到端流程
- [x] 10.4 验证 archive 质量捕获的完整流程：质量工件 → 摘要提取 → rules 生成 → 下次指令注入
- [x] 10.5 验证现有 `spec-driven` schema v1 的完全向后兼容（无 enhance 字段时行为不变）
- [x] 10.6 在 Windows 环境下验证路径处理
