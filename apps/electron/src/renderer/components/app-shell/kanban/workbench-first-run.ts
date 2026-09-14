/** Creation is already committed before this boundary. Always leave create mode
 * after a run attempt, including a rejected attempt, so retry cannot fork a task.
 * Saving alone must never invoke the runner.
 */
export async function finishWorkbenchCreation<T>(
  run: boolean,
  start: () => Promise<T>,
  leaveCreateMode: () => void,
  linkDocument?: () => Promise<void>,
): Promise<T | undefined> {
  try {
    // The task already exists. A failed association must neither start it nor
    // leave the editor in creation mode where a retry could duplicate it.
    await linkDocument?.()
    return run ? await start() : undefined
  } finally {
    leaveCreateMode()
  }
}
