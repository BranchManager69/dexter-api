import chalk from 'chalk';

type ChalkMethod = (value: string) => string;

interface ChalkWrapper {
  cyan: ChalkMethod;
  cyanBright: ChalkMethod;
  magenta: ChalkMethod;
  magentaBright: ChalkMethod;
  green: ChalkMethod;
  yellow: ChalkMethod;
  red: ChalkMethod;
  blue: ChalkMethod;
  blueBright: ChalkMethod;
  white: ChalkMethod;
  gray: ChalkMethod;
  bold: ChalkMethod;
  dim: ChalkMethod;
  underline: ChalkMethod;
}

const passthrough: ChalkMethod = (value: string) => String(value);

const chalkStub: ChalkWrapper = {
  cyan: passthrough,
  cyanBright: passthrough,
  magenta: passthrough,
  magentaBright: passthrough,
  green: passthrough,
  yellow: passthrough,
  red: passthrough,
  blue: passthrough,
  blueBright: passthrough,
  white: passthrough,
  gray: passthrough,
  bold: passthrough,
  dim: passthrough,
  underline: passthrough,
};

type Level = 'info' | 'warn' | 'error' | 'debug' | 'success';

type ConsoleMethod = (...data: unknown[]) => void;

function getColor(): ChalkWrapper {
  const rawForce = (process.env.DEXTER_FORCE_COLOR ?? '1').toLowerCase();
  const force = ['1', 'true', 'yes', 'on'].includes(rawForce);
  if (force && process.env.FORCE_COLOR !== '1') {
    process.env.FORCE_COLOR = '1';
  }
  const enabled = force || process.stdout.isTTY || process.env.FORCE_COLOR === '1';
  if (!enabled) return { ...chalkStub };

  const instance = chalk;
  const wrap = (...fns: Array<ChalkMethod | undefined>): ChalkMethod => (value: string) => {
    const str = String(value);
    for (const fn of fns) {
      if (!fn) continue;
      try {
        return fn(str);
      } catch {}
    }
    return str;
  };

  return {
    cyan: wrap(instance.cyan),
    cyanBright: wrap(instance.cyanBright, instance.cyan),
    magenta: wrap(instance.magenta),
    magentaBright: wrap(instance.magentaBright, instance.magenta),
    green: wrap(instance.green),
    yellow: wrap(instance.yellow),
    red: wrap(instance.red),
    blue: wrap(instance.blue),
    blueBright: wrap(instance.blueBright, instance.blue),
    white: wrap(instance.white),
    gray: wrap(instance.gray, instance.white),
    bold: wrap(instance.bold),
    dim: wrap(instance.dim),
    underline: wrap(instance.underline, instance.bold),
  };
}

const color = getColor();

const levelColor: Record<Level, ChalkMethod> = {
  info: color.white,
  warn: color.yellow,
  error: color.red,
  debug: color.gray,
  success: color.green,
};

const ANSI_PATTERN = /\u001b\[/u;

function hasAnsi(value: string): boolean {
  return ANSI_PATTERN.test(value);
}

function stringify(value: unknown): string {
  if (value == null) return '∅';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => stringify(item)).join(', ');
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function paintValue(raw: string): string {
  return hasAnsi(raw) ? raw : color.white(raw);
}

const statusColors: Record<string, ChalkMethod> = {
  info: color.yellow,
  start: color.yellow,
  success: color.green,
  ok: color.green,
  warn: color.yellow,
  error: color.red,
  fail: color.red,
  debug: color.gray,
};

function status(text: string, tone: keyof typeof statusColors = 'info'): string {
  const painter = statusColors[tone] ?? color.white;
  return painter(text.toUpperCase());
}

function keyValue(key: string, value: unknown): string {
  const raw = stringify(value);
  const painted = paintValue(raw);
  return `${color.cyanBright(key)}${color.dim('=')}${painted}`;
}

function list(values: unknown[], painter: ChalkMethod = color.white): string {
  return values.map((value) => painter(stringify(value))).join(color.dim(', '));
}

function identifier(value: unknown): string {
  return color.magentaBright(stringify(value));
}

function url(value: unknown): string {
  return color.blueBright(stringify(value));
}

function dim(text: string): string {
  return color.dim(text);
}

export const style = {
  status,
  kv: keyValue,
  list,
  id: identifier,
  url,
  dim,
  value: (value: unknown) => paintValue(stringify(value)),
  arrow: () => color.dim('›'),
};

function emit(label: string, level: Level, writer: ConsoleMethod, args: unknown[]) {
  if (!args.length) {
    writer(label);
    return;
  }

  const [first, ...rest] = args;
  if (typeof first === 'string') {
    const formatted = hasAnsi(first) ? first : levelColor[level](first);
    writer(`${label} ${formatted}`, ...rest);
    return;
  }

  writer(label, first, ...rest);
}

export interface DexterLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  success: (...args: unknown[]) => void;
  child: (suffix: string) => DexterLogger;
}

export function createLogger(namespace: string): DexterLogger {
  const label = color.cyan(`[${namespace}]`);

  const logger: DexterLogger = {
    info: (...args) => emit(label, 'info', console.log, args),
    warn: (...args) => emit(label, 'warn', console.warn, args),
    error: (...args) => emit(label, 'error', console.error, args),
    debug: (...args) => emit(label, 'debug', console.debug ? console.debug : console.log, args),
    success: (...args) => emit(label, 'success', console.log, args),
    child: (suffix: string) => createLogger(`${namespace}.${suffix}`),
  };

  return logger;
}

export const logger = createLogger('dexter-api');
