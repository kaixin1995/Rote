export function trackBackgroundTask(task: Promise<unknown>, code: string) {
  void task.catch((error) => {
    const warning = error instanceof Error ? error : new Error(String(error));
    warning.name = code;
    process.emitWarning(warning);
  });
}
