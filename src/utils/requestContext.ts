import { AsyncLocalStorage } from 'async_hooks';

export type RequestContext = {
  ip?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(ctx: RequestContext, fn: () => Promise<T> | T): Promise<T> | T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return storage.run(ctx, fn as any) as any;
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
