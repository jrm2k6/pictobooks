export type Logger = {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  step(name: string, meta?: Record<string, unknown>): void;
};

const formatMeta = (meta?: Record<string, unknown>) => {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  return ` ${JSON.stringify(meta)}`;
};

export const createLogger = (): Logger => ({
  info(message, meta) {
    console.log(`[info] ${message}${formatMeta(meta)}`);
  },
  warn(message, meta) {
    console.warn(`[warn] ${message}${formatMeta(meta)}`);
  },
  error(message, meta) {
    console.error(`[error] ${message}${formatMeta(meta)}`);
  },
  step(name, meta) {
    console.log(`\n[pipeline] ${name}${formatMeta(meta)}`);
  },
});
