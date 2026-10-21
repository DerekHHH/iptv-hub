/**
 * @file 手写并发池（零依赖）。
 *
 * 语义：固定 N 个 worker 从游标取任务，任务异常不会打断整池
 * （worker 内部 catch 后继续取下一个），结果数组与输入顺序一致。
 */

/**
 * 以固定并发跑完全部任务，结果按输入顺序返回。
 *
 * @param items 输入数组
 * @param worker 单个任务的执行函数
 * @param concurrency 并发数（<=0 视为 1）
 * @param onProgress 每完成一项回调（已完成数、总数）
 * @return 与输入等长的结果数组
 */
export async function runPool<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const total = items.length;
  const results = new Array<R>(total);
  if (total === 0) {
    return results;
  }

  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, total));
  let cursor = 0;
  let done = 0;

  const takeNext = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= total) {
        return;
      }
      const item = items[index] as T;
      results[index] = await worker(item, index);
      done += 1;
      if (onProgress) {
        onProgress(done, total);
      }
    }
  };

  const workers: Array<Promise<void>> = [];
  for (let index = 0; index < limit; index += 1) {
    workers.push(takeNext());
  }
  await Promise.all(workers);
  return results;
}
