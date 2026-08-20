import { describe, expect, it } from 'vitest';
import cssText from './tokens.css?raw';
import { breakpoints, colors, fonts, grid, radius, seal, spacing, tokens } from './tokens';

/**
 * TS ↔ CSS 一致性守卫：tokens.ts 与 tokens.css 必须严格同步。
 * 任何一侧新增/修改 Token 而忘记同步另一侧时，本测试失败。
 */
describe('tokens.ts 与 tokens.css 一致性', () => {
  it('6 个命名色双侧一致', () => {
    expect(cssText).toContain('--color-inkwell: #16233b;');
    expect(cssText).toContain('--color-draft: #f2f4f6;');
    expect(cssText).toContain('--color-ledger-teal: #0d7377;');
    expect(cssText).toContain('--color-clear: #1e8a4c;');
    expect(cssText).toContain('--color-watch: #b4530a;');
    expect(cssText).toContain('--color-breach: #c0312e;');
    expect(colors.inkwell.toLowerCase()).toBe('#16233b');
    expect(colors.ledgerTeal.toLowerCase()).toBe('#0d7377');
  });

  it('字体组合双侧一致', () => {
    expect(cssText).toContain(`--font-display: ${fonts.display};`);
    expect(cssText).toContain(`--font-body: ${fonts.body};`);
    expect(cssText).toContain(`--font-data: ${fonts.data};`);
  });

  it('三栏栅格规格双侧一致', () => {
    expect(cssText).toContain(`--grid-gap: ${grid.gap}px;`);
    expect(cssText).toContain(`--card-padding: ${grid.cardPadding}px;`);
    expect(cssText).toContain(`--rail-left-width: ${grid.railLeftWidth}px;`);
    expect(cssText).toContain(`--rail-right-width: ${grid.railRightWidth}px;`);
    expect(cssText).toContain(`--rail-right-collapsed-width: ${grid.railRightCollapsedWidth}px;`);
    expect(cssText).toContain(`--content-min-width: ${grid.contentMinWidth}px;`);
  });

  it('响应式断点字面值出现在媒体查询中', () => {
    expect(cssText).toContain(`@media (max-width: ${breakpoints.rightRailStack}px)`);
    expect(cssText).toContain(`@media (max-width: ${breakpoints.leftRailDrawer}px)`);
  });

  it('审计印章旋转角双侧一致', () => {
    expect(cssText).toContain(`--seal-rotation: ${seal.rotationDeg}deg;`);
  });

  it('间距与圆角阶梯双侧一致', () => {
    expect(cssText).toContain(`--space-2: ${spacing.space2}px;`);
    expect(cssText).toContain(`--space-6: ${spacing.space6}px;`);
    expect(cssText).toContain(`--radius-sm: ${radius.sm}px;`);
    expect(cssText).toContain(`--radius-card: ${radius.card}px;`);
    expect(cssText).toContain(`--radius-lg: ${radius.lg}px;`);
  });

  it('tokens 聚合对象覆盖全部 Token 组', () => {
    expect(Object.keys(tokens)).toEqual([
      'colors',
      'fonts',
      'grid',
      'breakpoints',
      'seal',
      'spacing',
      'radius',
      'motion',
      'zIndex',
      'chartSeries',
    ]);
  });
});
