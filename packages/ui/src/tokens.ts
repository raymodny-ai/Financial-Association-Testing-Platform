/**
 * @platform/ui · Design Tokens（TypeScript 侧）
 *
 * 与 ./tokens.css 保持严格一致：CSS variables 供样式层使用，
 * 本文件供图表库（ECharts/D3 配色）、canvas 绘制与组件逻辑引用。
 * 规则：禁止在业务代码中硬编码色值/字体，一律引用本文件常量。
 */

/** 6 个命名色（不引入第七色） */
export const colors = {
  /** 主文字与结构色，深墨蓝，替代纯黑 */
  inkwell: '#16233B',
  /** 冷调纸白背景 */
  draft: '#F2F4F6',
  /** 唯一强调色：主操作 / 显著性正向标记 / 选中态 */
  ledgerTeal: '#0D7377',
  /** 审计低风险语义色 */
  clear: '#1E8A4C',
  /** 审计中风险语义色 */
  watch: '#B4530A',
  /** 审计高风险语义色 */
  breach: '#C0312E',
} as const;

/** 审计风险等级 → 语义色映射（卡片 / 告警条 / 审计印章共用） */
export type AuditRiskLevel = 'clear' | 'watch' | 'breach';

export const riskColorMap: Record<AuditRiskLevel, string> = {
  clear: colors.clear,
  watch: colors.watch,
  breach: colors.breach,
};

/** 字体组合：展示（克制）/ 正文 / 数据 */
export const fonts = {
  /** Archivo（variable，Expanded 轴）：仅页面标题 / Tab 标签 / eyebrow */
  display: "'Archivo', 'IBM Plex Sans', system-ui, sans-serif",
  /** IBM Plex Sans：正文 / 表单 / 结论卡 */
  body: "'IBM Plex Sans', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
  /** IBM Plex Mono：统计量 / p 值 / 表格数字（须配合 tabular-nums） */
  data: "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace",
} as const;

/** 结果页三栏栅格规格（CSS Grid 12 列，左 3 / 中 7 / 右 2） */
export const grid = {
  columns: 12,
  /** 栏间距 */
  gap: 24,
  /** 卡片内边距 */
  cardPadding: 20,
  /** 左栏：配置摘要 + 风险标记条（sticky，禁止折叠） */
  railLeftWidth: 280,
  /** 右栏：研究注释 / 导出 / 分享（可折叠） */
  railRightWidth: 300,
  railRightCollapsedWidth: 48,
  /** 中栏最小宽度 */
  contentMinWidth: 720,
} as const;

/** 响应式断点（与 tokens.css 媒体查询字面值保持一致） */
export const breakpoints = {
  /** ≤1280px：右栏下沉到中栏下方 */
  rightRailStack: 1280,
  /** ≤1024px：左栏收为抽屉 */
  leftRailDrawer: 1024,
} as const;

/** 签名元素：审计印章（仅出现在结果总览卡右上角与 HTML 报告首页页眉两处） */
export const seal = {
  /** 双环圆形印章微旋转角 */
  rotationDeg: -3,
} as const;

/** 间距阶梯（4px 基准，与 tokens.css --space-* 严格一致） */
export const spacing = {
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 20,
  space6: 24,
  space8: 32,
  space10: 40,
  space12: 48,
} as const;

/** 圆角阶梯（与 tokens.css --radius-* 严格一致） */
export const radius = {
  sm: 4,
  card: 8,
  lg: 12,
} as const;

/** 动效规格（须尊重 prefers-reduced-motion） */
export const motion = {
  durationFastMs: 120,
  durationBaseMs: 200,
  /** 审计印章盖印动画时长 */
  durationSealMs: 600,
  easingStandard: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/** 层级（z-index，禁止裸写数字） */
export const zIndex = {
  sticky: 10,
  drawer: 100,
  overlay: 200,
  toast: 300,
} as const;

/** 图表序列色（ECharts/D3 用；仅由 6 命名色派生，不引入第七色相） */
export const chartSeries = [
  colors.ledgerTeal,
  colors.inkwell,
  colors.clear,
  colors.watch,
  colors.breach,
  /** Inkwell 45% 透明度（CSS 侧为 color-mix 等价物） */
  'rgba(22, 35, 59, 0.45)',
] as const;

/**
 * AntD ConfigProvider token 映射（apps/web 使用）。
 * 不依赖 antd 包，仅输出纯对象；消费方传入 ConfigProvider theme.token。
 */
export const antdTokenOverrides = {
  colorPrimary: colors.ledgerTeal,
  colorSuccess: colors.clear,
  colorWarning: colors.watch,
  colorError: colors.breach,
  colorTextBase: colors.inkwell,
  colorBgBase: colors.draft,
  fontFamily: fonts.body,
  fontFamilyCode: fonts.data,
  borderRadius: radius.card,
} as const;

export type DesignTokens = {
  colors: typeof colors;
  fonts: typeof fonts;
  grid: typeof grid;
  breakpoints: typeof breakpoints;
  seal: typeof seal;
  spacing: typeof spacing;
  radius: typeof radius;
  motion: typeof motion;
  zIndex: typeof zIndex;
  chartSeries: typeof chartSeries;
};

export const tokens: DesignTokens = {
  colors,
  fonts,
  grid,
  breakpoints,
  seal,
  spacing,
  radius,
  motion,
  zIndex,
  chartSeries,
};
