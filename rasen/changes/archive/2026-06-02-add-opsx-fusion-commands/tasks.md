## 1. Office-Hours 命令模板

- [x] 1.1 读取 `fusion/skills/opsx-office-hours/SKILL.md`，将其内容（去除 frontmatter）作为 instructions 字符串，创建 `src/core/templates/workflows/office-hours.ts`，导出 `getOfficeHoursCommandSkillTemplate(): SkillTemplate` 和 `getOpsxOfficeHoursCommandTemplate(): CommandTemplate`
- [x] 1.2 在 `src/core/templates/skill-templates.ts` 中添加 office-hours 的导出
- [x] 1.3 在 `src/core/shared/skill-generation.ts` 的 `getSkillTemplates()` 中注册 `{ template: getOfficeHoursCommandSkillTemplate(), dirName: 'openspec-opsx-office-hours', workflowId: 'office-hours-command' }`
- [x] 1.4 在 `getCommandTemplates()` 中注册 office-hours 命令模板
- [x] 1.5 替换 SKILL.md 内容中的 `~/.gstack/` → `~/.openspec/`，`fusion/` 路径引用清理

## 2. Verify-Enhanced 命令模板

- [x] 2.1 读取 `fusion/skills/opsx-verify-enhanced/SKILL.md`，创建 `src/core/templates/workflows/verify-enhanced.ts`，导出 `getVerifyEnhancedSkillTemplate(): SkillTemplate` 和 `getOpsxVerifyEnhancedCommandTemplate(): CommandTemplate`
- [x] 2.2 在 `skill-templates.ts` 和 `skill-generation.ts` 中注册 verify-enhanced
- [x] 2.3 替换内容中的路径引用

## 3. Ship 命令模板

- [x] 3.1 读取 `fusion/skills/opsx-ship/SKILL.md`，创建 `src/core/templates/workflows/ship.ts`，导出 `getShipCommandSkillTemplate(): SkillTemplate` 和 `getOpsxShipCommandTemplate(): CommandTemplate`
- [x] 3.2 在 `skill-templates.ts` 和 `skill-generation.ts` 中注册 ship
- [x] 3.3 替换内容中的路径引用

## 4. Retro 命令模板

- [x] 4.1 读取 `fusion/skills/opsx-retro/SKILL.md`，创建 `src/core/templates/workflows/retro.ts`，导出 `getRetroCommandSkillTemplate(): SkillTemplate` 和 `getOpsxRetroCommandTemplate(): CommandTemplate`
- [x] 4.2 在 `skill-templates.ts` 和 `skill-generation.ts` 中注册 retro
- [x] 4.3 替换内容中的路径引用

## 5. Auto 命令模板（含 dispatch agent 逻辑）

- [x] 5.1 读取 `fusion/skills/opsx-auto/SKILL.md` 和 `fusion/agents/dispatch.md`，合并内容，创建 `src/core/templates/workflows/auto.ts`，导出 `getAutoCommandSkillTemplate(): SkillTemplate` 和 `getOpsxAutoCommandTemplate(): CommandTemplate`
- [x] 5.2 在 `skill-templates.ts` 和 `skill-generation.ts` 中注册 auto
- [x] 5.3 替换内容中的路径引用，`fusion/` 引用替换为直接 skill 名称引用

## 6. Safety Hook

- [x] 6.1 将 `fusion/hooks/safety-check.sh` 复制到 `hooks/safety-check.sh`，替换内容中的 gstack 引用
- [x] 6.2 在 `src/core/init.ts` 的 init 完成输出中添加 safety hook 配置提示信息

## 7. 构建验证

- [x] 7.1 运行 `pnpm build` 验证 TypeScript 编译通过
- [x] 7.2 在 test_openspec 中运行 `openspec init --tools claude --force`，验证新增的 5 个 OPSX 命令 skill 正确生成
- [x] 7.3 检查生成的 SKILL.md 文件中不含 `fusion/` 或 `~/.gstack/` 路径引用
