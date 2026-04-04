# Explore 页面布局跳动排查矩阵

## 目标

用于系统化排查 Explore 页面在“进入用户页再返回”时滚动位置下沉的问题。

核心思路不是只盯着 scroll restore，而是把所有可能导致“恢复后页面继续变高”的来源拆开分析。

## 排查矩阵

| 类别 | 典型现象 | 代码位置 | 风险等级 | 修复优先级 |
| --- | --- | --- | --- | --- |
| 附件媒体加载后撑高 | 回到带图/视频的笔记附近时，位置继续往下漂 | `web/src/components/rote/AttachmentsGrid.tsx` | 高 | 最高 |
| 列表页数尚未恢复完整 | 回到 Explore 深位置后，列表继续补页，页面继续变长 | `web/src/components/rote/roteList.tsx` `web/src/pages/explore/index.tsx` | 高 | 高 |
| 列表项懒渲染导致高度变化 | 某些卡片进入视口后才切换真实内容，高度出现二次变化 | `web/src/components/rote/roteItem.tsx` `web/src/components/rote/Reactions.tsx` | 中高 | 高 |
| 顶部异步模块插入 | 页面顶部公告等内容晚于列表出现，把整页整体往下推 | `web/src/pages/explore/index.tsx` `web/src/hooks/useSiteStatus.ts` | 中 | 中 |
| 滚动恢复机制互相干扰 | 浏览器原生恢复、自定义恢复、布局变化叠加产生多次跳动 | `web/src/hooks/useSaveScrollPosition.ts` | 中 | 已处理，保留观察 |

## 1. 附件媒体加载后撑高

### 典型表现

- 返回 Explore 后，位置先接近原位
- 单图、长图、视频加载完成后，卡片高度变大
- 页面最终停在原位置下方

### 当前代码特征

- 多图场景较多使用固定方格
- 单图和视频没有基于真实尺寸预留高度
- 图片和视频完成加载后，卡片高度才最终确定

关键位置：

- [AttachmentsGrid.tsx](/Users/rabithua/.superset/worktrees/Rote/fix-scroll-bug/web/src/components/rote/AttachmentsGrid.tsx#L17)
- [VideoAttachmentPreview.tsx](/Users/rabithua/.superset/worktrees/Rote/fix-scroll-bug/web/src/components/rote/VideoAttachmentPreview.tsx#L19)

### 如何验证

- 选一条单图笔记，回页时观察是否在图片加载后发生明显下沉
- 在浏览器 DevTools 中禁用缓存，复现概率通常更高
- 暂时把图片区域替换成固定高度占位，比较跳动是否明显减弱

### 处理方式

- 为附件增加 `width`、`height`
- 上传阶段直接提取尺寸并入库
- 前端使用 `aspect-ratio` 预留空间
- 视频优先使用 poster 尺寸进行预占位

### 结论

这是最像根因修复的部分，应优先处理。

## 2. 列表页数尚未恢复完整

### 典型表现

- 从 Explore 很深的位置进入用户页
- 返回后列表并没有立刻恢复到离开前的数据规模
- 滚动位置先恢复，再随着补页继续变化

### 当前代码特征

- Explore 使用 `useAPIInfinite`
- 列表底部通过 `IntersectionObserver` 触发 `loadMore`
- 返回页面时，已加载页数不一定与离开前一致

关键位置：

- [explore/index.tsx](/Users/rabithua/.superset/worktrees/Rote/fix-scroll-bug/web/src/pages/explore/index.tsx#L61)
- [roteList.tsx](/Users/rabithua/.superset/worktrees/Rote/fix-scroll-bug/web/src/components/rote/roteList.tsx#L31)

### 如何验证

- 在离开 Explore 前记录当前已经加载到第几页
- 返回后观察初始页数是否一致
- 人为关闭 `loadMore`，仅恢复已有页面，看是否仍然明显下沉

### 处理方式

- 记录离开时的页数或 item 数
- 返回时先恢复相同数据规模，再执行滚动恢复
- 更进一步可缓存 Explore 的 SWR Infinite 状态，避免重新从浅页开始

### 结论

如果用户常从很深的 feed 返回，这一项影响会很明显。

## 3. 列表项懒渲染导致高度变化

### 典型表现

- 返回后部分卡片刚进入视口时继续变化
- 位移幅度通常比图片小，但会叠加

### 当前代码特征

- `RoteItem` 中部分区域只有 `inView` 后才渲染真实内容
- reaction 区在占位和真实内容之间切换，可能带来高度差

关键位置：

- [roteItem.tsx](/Users/rabithua/.superset/worktrees/Rote/fix-scroll-bug/web/src/components/rote/roteItem.tsx#L246)
- [Reactions.tsx](/Users/rabithua/.superset/worktrees/Rote/fix-scroll-bug/web/src/components/rote/Reactions.tsx#L118)

### 如何验证

- 暂时去掉 `inView` 条件，始终渲染真实内容，比较回页稳定性
- 或给 reaction 区加固定最小高度，比较跳动是否减少

### 处理方式

- 让占位高度与真实内容高度尽量一致
- 为 reaction 区设置稳定的最小高度
- 保留懒渲染，但避免“进视口后卡片变高”

### 结论

这一项通常不是唯一原因，但很可能与媒体加载问题叠加。

## 4. 顶部异步模块插入

### 典型表现

- 返回页面时顶部结构尚未完全出现
- 之后公告条或其他站点配置内容被插入
- 整个列表整体向下移动

### 当前代码特征

- Explore 顶部的公告依赖 `useSiteStatus`
- 如果请求结果晚于页面主内容返回，会发生后插入

关键位置：

- [explore/index.tsx](/Users/rabithua/.superset/worktrees/Rote/fix-scroll-bug/web/src/pages/explore/index.tsx#L272)
- [useSiteStatus.ts](/Users/rabithua/.superset/worktrees/Rote/fix-scroll-bug/web/src/hooks/useSiteStatus.ts#L56)

### 如何验证

- 禁用公告模块，比较问题是否减弱
- 在慢网环境下复现，看公告出现时是否伴随整体位移

### 处理方式

- 为公告区域预留固定高度
- 提前缓存 `siteStatus`
- 恢复滚动前尽量让顶部稳定结构先到位

### 结论

它更像放大器，不一定是主因，但足以造成可见位移。

## 5. 滚动恢复机制互相干扰

### 典型表现

- 返回页面时像是恢复了不止一次
- 恢复到目标位置后，又被后续机制改写

### 当前代码特征

- 浏览器原生历史恢复可能和自定义恢复叠加
- 页面内容异步变化时，scroll anchoring 可能继续推动视口

关键位置：

- [useSaveScrollPosition.ts](/Users/rabithua/.superset/worktrees/Rote/fix-scroll-bug/web/src/hooks/useSaveScrollPosition.ts#L52)

### 如何验证

- 对比开启和关闭 `history.scrollRestoration`
- 对比启用和关闭恢复校准逻辑
- 观察回页时 `scrollY` 是否在短时间内变化多次

### 当前处理

- 已经切换为手动 scroll restoration
- 已增加短时间滚动校准
- 已避免路由切换时记录到错误页面的滚动值

### 结论

这是必要兜底，但不是长期唯一解。

## 建议执行顺序

1. 先处理附件尺寸与媒体占位
2. 再处理 Explore 返回时的数据页数恢复
3. 然后修正 `inView` 懒渲染区域的高度差
4. 再处理公告等顶部异步模块
5. 最后视效果评估是否还需要继续强化 scroll restore

## 最终判断标准

满足以下条件时，可以认为问题已经基本收敛：

- 回到带单图的笔记附近时，不再出现明显下沉
- 回到深层 Explore 列表时，不因补页继续明显位移
- 页面顶部异步模块出现时，不再引发整页可见跳动
- scroll restore 不再依赖长时间反复校准才能接近目标位置

