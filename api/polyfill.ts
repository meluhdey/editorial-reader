import { createRequire } from 'module';

if (typeof process.getBuiltinModule !== 'function') {
  console.log('[Polyfill] process.getBuiltinModule is missing. Registering fallback require polyfill.');
  const require = createRequire(import.meta.url);
  process.getBuiltinModule = function (name: string) {
    return require(name);
  } as any;
}
