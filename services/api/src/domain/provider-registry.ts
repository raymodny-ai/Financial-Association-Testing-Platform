/**
 * provider 插件注册表（ADR 001：插件式注册，可扩展性要求）。
 * 应用启动时由各适配器自行 registerProvider；任务执行按 dataSource.provider 取用。
 */
import type { DataProvider } from './data-provider.js';

const providers = new Map<string, DataProvider>();

export function registerProvider(provider: DataProvider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name: string): DataProvider | undefined {
  return providers.get(name);
}

export function listProviderNames(): string[] {
  return [...providers.keys()];
}
