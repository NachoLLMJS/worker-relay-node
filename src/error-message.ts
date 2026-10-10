export function boundedErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export function installBoundedFatalErrorHandlers(): void {
  const fail = (error: unknown) => {
    console.error(boundedErrorMessage(error));
    process.exit(1);
  };
  process.once("uncaughtException", fail);
  process.once("unhandledRejection", fail);
}