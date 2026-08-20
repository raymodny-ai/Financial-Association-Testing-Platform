/**
 * jstat 最小本地类型声明（官方无 @types/jstat）。
 * 定案：jstat 仅用作分布函数（ADR 001），此处只声明所需分布的 CDF。
 * 注意：jstat 为 CJS 包，Node ESM 下命名导入无法静态解析，
 * 一律 default 导入（module.exports）后解构，vitest 与 tsx 行为一致。
 */
declare module 'jstat' {
  interface JStatDistribution {
    cdf(x: number, dof: number): number;
  }
  const jstat: {
    chisquare: JStatDistribution;
    studentt: JStatDistribution;
  };
  export default jstat;
}
