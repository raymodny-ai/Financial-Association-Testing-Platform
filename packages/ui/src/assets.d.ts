/** Vitest/Vite 资产导入声明（tokens.css?raw 用于 TS↔CSS 一致性测试） */
declare module '*.css?raw' {
  const content: string;
  export default content;
}
