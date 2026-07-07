# 团队中的 OpenSpec

其他指南里讲到的一切，无论你是单人开发还是在二十人的团队里，都同样适用。在团队中改变的是那些边缘问题：规范放在哪里、队友如何评审一份计划、以及这一切如何与我们既有的 pull request 流程相契合。

简短的回答是：一次变更只是一些文件，而 OpenSpec 从不触碰 git。所以它适配你现有的工作流，而不是取而代之。本页把那些行之有效的约定讲清楚。

## 一条规则：OpenSpec 不触碰 git

OpenSpec 只在 `openspec/` 下读写纯 Markdown。它从不在你的项目里提交、分支、推送或拉取——也从不自行克隆或同步某个 [Store](stores-beta/user-guide.md)。这意味着：

- **你像对待任何源码一样提交 `openspec/`。** 规范、进行中的变更和归档都是你项目历史的一部分。（没错，把整个文件夹提交进去——参见 [FAQ](faq.md#should-i-commit-the-openspec-folder-to-git)。）
- **一次变更就是一个你像代码一样做版本管理的文件夹。** `openspec/changes/add-dark-mode/` 在某个分支上只不过是一些文件。
- **以下所有内容都是约定，而非强制。** OpenSpec 不会逼你这么做；它只是恰好能干净地契合。

## 日常循环

行之有效的工作流，是把一次变更映射到一个分支和一个 pull request：

```
git switch -c add-dark-mode        start a branch, as usual
   │
/opsx:propose add-dark-mode        draft the plan (proposal + specs + tasks)
   │
REVIEW THE PLAN                    you read it before any code — see Reviewing a Change
   │
/opsx:apply                        build it; artifacts + code change together
   │
git commit && open a PR            the PR contains the spec delta AND the code
   │
teammate reviews, merges
   │
/opsx:archive                      fold the delta into specs/, move the change to archive/
```

计划和代码并排住在同一个分支里，所以你的队友会一起评审两者；而六个月之后，归档的规范仍然能解释代码为什么是现在这个样子。

## 在 pull request 中评审规范

这正是团队体会到收益的地方。当一份 PR 包含了变更的增量规范时，评审者会得到一样原始 diff 永远给不了他们的东西：**一段用大白话讲清楚这次变更应当做到什么**的陈述，而且是在他们读任何一行代码之前。

对评审者来说，一个好的评审顺序是：

1. **读 `proposal.md`** ——这是不是正确的问题和范围？
2. **读 `specs/` 下的增量**——“完成”是否被正确地定义了？（这就是[评审一次变更](reviewing-changes.md)里那两分钟的过一遍，现在发生在 PR 里。）
3. **然后再读代码 diff**——它是否精确地交付了那些需求？

一个对*做法*不认同的评审者，可以针对提案低成本地表达异议，而不必在 300 行代码里反复纠缠。把增量规范放在 PR 描述里靠前的位置，或者把评审者指向变更文件夹，让他们从那里开始。

## 何时归档

归档会把一次变更的增量折叠进你的主 `openspec/specs/`，并把变更文件夹移动到 `openspec/changes/archive/YYYY-MM-DD-<name>/`。因为 `specs/` 是**共享的唯一事实来源**，所以时机在团队中很重要。两种可行的约定：

- **在 PR 合并之后归档（推荐）。** 分支承载着进行中的变更；一旦它合并到你的主分支，就在那里归档（通常是一个很小的后续提交，或一次定时清理）。这让共享的 `specs/` 只随着真正发布的工作向前推进。
- **在 PR 内部归档。** 对小团队更简单：添加代码的那份 PR 同时完成同步和归档。代价是你的 `specs/` diff 和代码 diff 一起落地，可能让 PR 变得更嘈杂。

挑一种并保持一致。无论哪种方式，`/opsx:archive` 都会检查任务是否完成，并会先提议同步，所以不会有东西被意外地以半成品状态合并。

## 两个人、并行的变更

因为变更是各自独立的文件夹，所以它们不会相互冲突：

- **不同的变更、不同的人——没问题。** `add-dark-mode` 和 `rate-limit-login` 是不同分支上的不同文件夹；在它们都归档之前，彼此从不触碰。
- **一次变更、一个负责人。** 两个人编辑同一个变更文件夹，其冲突方式就和两个人编辑同一个文件完全一样。让一次变更保持单一作者，或者把它拆成两次变更（这也是[给变更定准大小](writing-specs.md#right-size-the-change)的又一个理由）。
- **唯一会出现冲突的地方是 `specs/`。** 如果两次变更都修改了*同一条*需求，归档第二次时会在 `openspec/specs/…/spec.md` 中冲突——像处理任何合并冲突一样解决它，保留那条反映现实的需求。这种情况很少见，而且它是一个特性：这是 git 在告诉你，有两次变更对系统应当如何表现给出了不一致的意见。

## 当规划超出一个仓库时

以上所有内容都假设计划住在代码仓库自己的 `openspec/` 文件夹里，这是正确的默认选择。当你的规划确实横跨多个仓库或多个团队时——比如一个功能触及三个服务，或者需求由一个团队拥有、其他团队消费——那就是 beta 阶段的 **stores** 功能的用武之地：规划拥有它自己的仓库，任何代码仓库都可以指向它。从 [Store：用户指南](stores-beta/user-guide.md) 开始了解。

## 接下来去哪里

- [评审一次变更](reviewing-changes.md) ——那次评审的过一遍，现在发生在你的 PR 内。
- [写好规范](writing-specs.md) ——包括如何给一次变更定准大小，让它能装进一个分支。
- [Store：用户指南](stores-beta/user-guide.md) ——横跨仓库和团队的规划。
