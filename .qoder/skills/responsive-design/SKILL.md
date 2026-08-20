---
name: responsive-design
description: Implement modern responsive layouts using container queries, fluid typography, CSS Grid, and mobile-first breakpoint strategies. Use when building adaptive interfaces, implementing fluid layouts, or creating component-level responsive behavior. Adapted for this project's React + AntD + tokens.css stack (no Tailwind).
---

# Responsive Design（项目适配版）

掌握现代响应式设计技术，创建能在所有屏幕尺寸和设备上下文中无缝适配的界面。
本技能已适配本项目技术栈：**React + Ant Design 5 + @platform/ui 的 tokens.css**。所有 Tailwind 示例已替换为 AntD 组件与原生 CSS 写法。

## 项目约定（优先级最高，覆盖下文通用模式）

1. **样式事实来源唯一**：颜色、字体、间距、栅格规格必须引用 `packages/ui/src/tokens.css` 中的 CSS 变量，**禁止硬编码**色值/字号/间距。
2. **不使用 Tailwind**。布局用原生 CSS（Grid/Flexbox/容器查询）+ AntD 组件的响应式能力。
3. **项目断点（与 tokens.css 注释一致）**：
   - `≤1280px`：结果页右栏下沉到中栏下方
   - `≤1024px`：结果页左栏收为抽屉
   - CSS 媒体查询须写**字面值**（tokens.css 规定不将断点定义为变量）；JS 侧判断可用 AntD `Grid.useBreakpoint()`。
4. **字号阶梯为固定 px**（`--text-display: 28px` / `--text-heading: 20px` / `--text-body: 14px` / `--text-data: 13px` / `--text-caption: 12px`）。流式排版（clamp）默认不用于正文，仅在确有需要时**先在 tokens.css 中新增 token 再引用**。
5. **三栏布局容器已存在**：`.layout-results`（含 1280/1024 降级规则）已在 tokens.css 中定义，结果页直接使用，不要另建栅格。
6. **数据字体**：所有统计量/p 值/表格数字用 `--font-data` 或 `.font-data` 类（tabular-nums 纵向对齐）。
7. **动效底线**：任何响应式过渡动画必须尊重 `prefers-reduced-motion`（tokens.css 已全局处理）。
8. **AntD 优先**：响应式能力优先用 AntD 现成方案——`Row/Col` 响应式断点属性（xs/sm/md/lg/xl/xxl）、`Grid.useBreakpoint()`、`Table` 的 `scroll={{ x }}`、`Drawer`、`Flex`。

## When to Use This Skill

- 实现移动优先的响应式布局
- 使用容器查询实现组件级响应式
- 创建流式排版与间距体系
- 用 CSS Grid 和 Flexbox 构建复杂布局
- 为设计系统设计断点策略
- 实现响应式图片与媒体
- 创建自适应导航模式
- 构建响应式表格与数据展示

## Core Capabilities

### 1. 容器查询（Container Queries）

- 组件级响应式，独立于视口
- 容器查询单位（cqi、cqw、cqh）
- 样式查询（style queries）做条件样式
- 浏览器兼容降级方案

### 2. 流式排版与间距（Fluid Typography & Spacing）

- CSS `clamp()` 流式缩放
- 视口相对单位（vw、vh、dvh）
- 带最小/最大边界的流式字号阶梯
- 响应式间距系统

### 3. 布局模式（Layout Patterns）

- CSS Grid 用于 2D 布局
- Flexbox 用于 1D 分配
- 内在布局（基于内容的尺寸）
- Subgrid 嵌套网格对齐

### 4. 断点策略（Breakpoint Strategy）

- 移动优先媒体查询
- 基于内容的断点
- 设计 Token 集成
- 特性查询（@supports）

## Quick Reference

### 断点阶梯与项目映射

```css
/* 通用现代断点阶梯（移动优先） */
/* 基础: 移动端 (< 640px) */
@media (min-width: 640px) { /* sm: 横屏手机、小平板 */ }
@media (min-width: 768px) { /* md: 平板 */ }
@media (min-width: 1024px) { /* lg: 笔记本、小桌面 ← 项目关键断点 */ }
@media (min-width: 1280px) { /* xl: 桌面 ← 项目关键断点 */ }
@media (min-width: 1536px) { /* 2xl: 大桌面 */ }
```

**本项目只重点使用两档**（与 tokens.css 的响应式规格对齐）：

| 断点 | 行为 | AntD useBreakpoint |
|---|---|---|
| `≤1280px`（即 `xl` 未命中） | 右栏下沉到中栏下方 | `screens.xl === false` |
| `≤1024px`（即 `lg` 未命中） | 左栏收为抽屉 | `screens.lg === false` |

## Key Patterns

### Pattern 1：容器查询

```css
/* 定义容器上下文（写在组件配套 CSS 文件中） */
.card-container {
  container-type: inline-size;
  container-name: card;
}

/* 查询容器而非视口 */
@container card (min-width: 400px) {
  .stat-card {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: var(--grid-gap);
  }
}

@container card (min-width: 600px) {
  .stat-card {
    grid-template-columns: 250px 1fr;
  }
  .stat-card__title {
    font-size: var(--text-heading); /* 引用 token，禁止硬编码 */
  }
}

/* 容器查询单位：5% 容器宽度，限制在 1rem–2rem 之间 */
.stat-card__value {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
  font-size: clamp(1rem, 5cqi, 2rem);
}
```

```tsx
// React 组件：用 AntD Card + 配套 CSS 类，不用 Tailwind 工具类
import { Card } from 'antd';
import './StatCard.css'; // 内含上方容器查询规则

function StatCard({ title, value, description }: StatCardProps) {
  return (
    <div className="card-container">
      <Card className="stat-card" variant="borderless">
        <div>
          <h3 className="stat-card__title">{title}</h3>
          <p className="stat-card__value">{value}</p>
        </div>
        <p className="stat-card__desc">{description}</p>
      </Card>
    </div>
  );
}
```

### Pattern 2：流式排版

> **项目约定**：默认使用 tokens.css 的固定 px 阶梯。仅当页面级大标题确需流式缩放时，先在 tokens.css 新增 token 再引用，不要在业务 CSS 里私设 `--text-*` 变量。

```css
/* ✅ 推荐：在 tokens.css 中新增流式 token（示例：仅页面大标题） */
:root {
  --text-display-fluid: clamp(1.5rem, 1.2rem + 1vw, 1.75rem); /* 约 24→28px */
}

/* ✅ 流式间距 token（如需，同样先入 tokens.css） */
:root {
  --space-fluid-lg: clamp(1.5rem, 1.2rem + 1.5vw, 2.5rem);
}

/* 使用 */
.page-title {
  font-family: var(--font-display);
  font-size: var(--text-display-fluid);
}
```

```ts
// tokens.ts 工具函数：生成 clamp 表达式（用于按需扩展 token）
export function fluidValue(
  minSize: number,
  maxSize: number,
  minWidth = 320,
  maxWidth = 1280,
): string {
  const slope = (maxSize - minSize) / (maxWidth - minWidth);
  const yAxisIntersection = -minWidth * slope + minSize;
  return `clamp(${minSize}rem, ${yAxisIntersection.toFixed(4)}rem + ${(slope * 100).toFixed(4)}vw, ${maxSize}rem)`;
}
```

### Pattern 3：CSS Grid 响应式布局

```css
/* 总览卡片行：自动换行网格（卡片间距用 token） */
.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: var(--grid-gap);
}

/* 结果页三栏：直接复用 tokens.css 已定义的 .layout-results，
   其内置 ≤1280px 右栏下沉、≤1024px 单列 的降级规则。
   若需自定义页面级布局，遵循同样的断点字面值： */
.page-layout {
  display: grid;
  grid-template-areas:
    "header"
    "main"
    "sidebar";
  gap: var(--grid-gap);
}

@media (min-width: 1024px) {
  .page-layout {
    grid-template-columns: var(--rail-left-width) minmax(var(--content-min-width), 1fr) var(--rail-right-width);
    grid-template-areas:
      "header header header"
      "nav main sidebar";
  }
}

.page-layout > .header { grid-area: header; }
.page-layout > .main   { grid-area: main; }
.page-layout > .sidebar { grid-area: sidebar; }
```

```tsx
// 方式一：AntD Row/Col 响应式断点属性（xs/sm/md/lg/xl/xxl）
import { Row, Col } from 'antd';

function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <Row gutter={[24, 24]}>
      {metrics.map((m) => (
        <Col key={m.id} xs={24} sm={12} lg={8} xl={6}>
          <MetricCard metric={m} />
        </Col>
      ))}
    </Row>
  );
}

// 方式二：auto-fit 网格组件（内容自适应，无需断点）
function OverviewGrid({ children }: PropsWithChildren) {
  return <div className="overview-grid">{children}</div>;
}
```

### Pattern 4：响应式导航（AntD 版）

```tsx
import { useState } from 'react';
import { Layout, Menu, Drawer, Button, Grid } from 'antd';
import { MenuOutlined } from '@ant-design/icons';

function ResponsiveNav({ items }: { items: NavItem[] }) {
  const screens = Grid.useBreakpoint();
  const [open, setOpen] = useState(false);
  const isDesktop = screens.lg; // ≤1024px 走抽屉

  const menuItems = items.map((item) => ({ key: item.key, label: item.label }));

  return (
    <Layout.Header style={{ display: 'flex', alignItems: 'center' }}>
      {isDesktop ? (
        <Menu mode="horizontal" items={menuItems} />
      ) : (
        <>
          <Button
            type="text"
            icon={<MenuOutlined />}
            aria-expanded={open}
            aria-controls="nav-menu"
            onClick={() => setOpen(true)}
          />
          <Drawer
            id="nav-menu"
            placement="left"
            open={open}
            onClose={() => setOpen(false)}
            styles={{ body: { padding: 0 } }}
          >
            <Menu mode="inline" items={menuItems} onClick={() => setOpen(false)} />
          </Drawer>
        </>
      )}
    </Layout.Header>
  );
}
```

### Pattern 5：响应式图片

```tsx
// 艺术指导：不同断点不同裁切（原生 picture，与框架无关）
function ResponsiveHero() {
  return (
    <picture>
      <source media="(min-width: 1024px)" srcSet="/hero-wide.webp" type="image/webp" />
      <source media="(min-width: 768px)" srcSet="/hero-medium.webp" type="image/webp" />
      <source srcSet="/hero-mobile.webp" type="image/webp" />
      <img
        src="/hero-mobile.jpg"
        alt="Hero image description"
        style={{ width: '100%', height: 'auto' }}
        loading="eager"
        fetchPriority="high"
      />
    </picture>
  );
}

// 分辨率切换：srcset + sizes
function ProductImage({ product }: { product: Product }) {
  return (
    <img
      src={product.image}
      srcSet={`${product.image}?w=400 400w, ${product.image}?w=800 800w, ${product.image}?w=1200 1200w`}
      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
      alt={product.name}
      style={{ width: '100%', height: 'auto', objectFit: 'cover' }}
      loading="lazy"
    />
  );
}
```

### Pattern 6：响应式表格（AntD 版）

```tsx
import { Table, Card, Descriptions } from 'antd';
import type { TableProps } from 'antd';

// 方案一：横向滚动（首选，统计结果表格列多时适用）
// scroll.x 写表格最小内容宽度；数字列 render 时套 .font-data 保证 tabular-nums 对齐
function ResultTable({ data, columns }: ResultTableProps) {
  const tableProps: TableProps<ResultRow> = {
    dataSource: data,
    columns: columns.map((col) => ({
      ...col,
      // 数值列强制数据字体
      render: col.numeric
        ? (v) => <span className="font-data">{v}</span>
        : col.render,
    })),
    scroll: { x: 600 }, // min-width 语义，小屏出现横向滚动条
    pagination: false,
  };
  return <Table {...tableProps} rowKey="id" />;
}

// 方案二：桌面表格 + 移动端卡片双渲染（行信息少、需纵向阅读时）
import { Grid } from 'antd';

function AdaptiveResultList({ data }: { data: ResultRow[] }) {
  const screens = Grid.useBreakpoint();
  const isDesktop = screens.md; // ≥768px

  if (isDesktop) {
    return <ResultTable data={data} columns={resultColumns} />;
  }

  // 移动端：每条记录一张卡片
  return (
    <div style={{ display: 'grid', gap: 'var(--grid-gap)' }}>
      {data.map((row) => (
        <Card key={row.id} styles={{ body: { padding: 'var(--card-padding)' } }}>
          <Descriptions
            column={1}
            size="small"
            items={resultColumns.map((col) => ({
              key: String(col.key),
              label: col.title,
              children: row[col.dataIndex as keyof ResultRow],
            }))}
          />
        </Card>
      ))}
    </div>
  );
}
```

## Viewport Units

```css
/* 标准视口单位 */
.full-height {
  height: 100vh; /* 移动端可能有问题 */
}

/* 动态视口单位（移动端推荐） */
.full-height-dynamic {
  height: 100dvh; /* 考虑移动浏览器 UI 伸缩 */
}

/* 最小 / 最大视口 */
.min-full-height { min-height: 100svh; }
.max-full-height { max-height: 100lvh; }

/* 视口相对字号（仅限确需流式的展示层标题，且须先入 tokens.css） */
.hero-title {
  font-size: clamp(2rem, 5vw, 4rem);
}
```

## Best Practices

1. **Mobile-First**：从移动端样式起步，向大屏增强（本项目以桌面研究员为主，但窄屏降级路径 1280→1024 必须完整）
2. **Content Breakpoints**：按内容而非设备设断点（本项目已定 1280/1024 两档，新增断点须先更新 tokens.css 注释）
3. **Fluid Over Fixed**：排版间距优先流式值——但本项目字号阶梯为固定 px，改动须走 tokens.css
4. **Container Queries**：组件级响应式首选
5. **Test Real Devices**：模拟器无法覆盖所有真机问题
6. **Performance**：优化图片、对屏外内容懒加载（AntD Table 大数据用 `virtual`）
7. **Touch Targets**：移动端触控目标最小 44×44px（AntD 默认控件基本满足，自定义按钮需自查）
8. **Logical Properties**：使用 inline/block 逻辑属性以支持国际化
9. **Tokens First（项目补充）**：任何响应式样式中的颜色/字体/间距必须引用 tokens.css 变量

## Common Issues

- **Horizontal Overflow**：内容撑出视口（结果页中栏 min 720px，窄屏务必验证降级后不再触发横向滚动）
- **Fixed Widths**：用 px 而非相对单位
- **Viewport Height**：移动端 100vh 问题
- **Font Size**：移动端文字过小
- **Touch Targets**：按钮太小难点按
- **Aspect Ratio**：图片被压扁拉伸
- **Z-Index Stacking**：遮罩在不同屏幕失效（AntD Drawer/Modal 自带层级管理，自定义遮罩须对齐其 z-index 体系）
