/** Cleanup must not hold the session/Conductor completion seam indefinitely. */
export async function waitForRuntimeCleanup<T>(operation: Promise<T>, stage: string, timeoutMs = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${stage} cleanup timed out; resource shutdown is unconfirmed`)), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer!); }
}
