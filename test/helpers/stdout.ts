export function setStdoutRows(rows: number | undefined): () => void {
  const originalRowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  const originalWindowSizeDescriptor = Object.getOwnPropertyDescriptor(
    process.stdout,
    'getWindowSize'
  );
  Object.defineProperty(process.stdout, 'rows', {
    configurable: true,
    value: rows,
  });
  Object.defineProperty(process.stdout, 'getWindowSize', {
    configurable: true,
    value: undefined,
  });

  return () => {
    if (originalRowsDescriptor) {
      Object.defineProperty(process.stdout, 'rows', originalRowsDescriptor);
    } else {
      Reflect.deleteProperty(process.stdout, 'rows');
    }
    if (originalWindowSizeDescriptor) {
      Object.defineProperty(process.stdout, 'getWindowSize', originalWindowSizeDescriptor);
    } else {
      Reflect.deleteProperty(process.stdout, 'getWindowSize');
    }
  };
}
