import { build, type BuildOptions } from 'esbuild';
import { join } from 'node:path';
import { rollup, type InputOptions, type OutputOptions } from 'rollup';
import { minify } from 'terser';
import {
  fileSize,
  getBanner,
  readFile,
  rollupOnWarn,
  target,
  watcher,
  writeFile,
  type BuildConfig,
} from './util';

/**
 * Build the core package which is also the root package: @builder.io/qwik
 *
 * Uses esbuild during development (cuz it's super fast) and
 * TSC + Rollup + Terser for production, because it generates smaller code
 * that minifies better.
 */
export function submoduleCore(config: BuildConfig) {
  if (config.dev) {
    return submoduleCoreDev(config);
  }
  return submoduleCoreProd(config);
}

async function submoduleCoreProd(config: BuildConfig) {
  const input: InputOptions = {
    input: join(config.tscDir, 'packages', 'qwik', 'src', 'core', 'index.js'),
    onwarn: rollupOnWarn,
    external: ['@builder.io/qwik/build'],
    plugins: [
      {
        name: 'setVersion',
        generateBundle(_, bundles) {
          for (const f in bundles) {
            const b = bundles[f];
            if (b.type === 'chunk') {
              b.code = b.code.replace(
                'globalThis.QWIK_VERSION',
                JSON.stringify(config.distVersion)
              );
            }
          }
        },
      },
    ],
  };

  const esmOutput: OutputOptions = {
    dir: join(config.distQwikPkgDir),
    format: 'es',
    entryFileNames: 'core.mjs',
    sourcemap: true,
    banner: getBanner('@builder.io/qwik', config.distVersion),
  };

  const cjsOutput: OutputOptions = {
    dir: join(config.distQwikPkgDir),
    format: 'umd',
    name: 'qwikCore',
    entryFileNames: 'core.cjs',
    sourcemap: true,
    globals: {
      '@builder.io/qwik/build': 'qwikBuild',
    },
    banner: getBanner('@builder.io/qwik', config.distVersion),
  };

  const build = await rollup(input);

  await Promise.all([build.write(esmOutput), build.write(cjsOutput)]);

  console.log('🦊 core.mjs:', await fileSize(join(config.distQwikPkgDir, 'core.mjs')));

  const inputCore = join(config.distQwikPkgDir, 'core.mjs');
  const inputMin: InputOptions = {
    input: inputCore,
    onwarn: rollupOnWarn,
    plugins: [
      {
        name: 'build',
        resolveId(id) {
          if (id === '@index.min') {
            return id;
          }
          if (id === '@builder.io/qwik/build') {
            return id;
          }
        },
        load(id) {
          if (id === '@builder.io/qwik/build') {
            return `
              export const isServer = false;
              export const isBrowser = true;
              export const isDev = false;
            `;
          }
        },
      },
    ],
  };
  const buildMin = await rollup(inputMin);
  await buildMin.write({
    dir: join(config.distQwikPkgDir),
    format: 'es',
    entryFileNames: 'core.min.mjs',
    plugins: [
      {
        name: 'minify',
        async renderChunk(code) {
          const esmMinifyResult = await minify(code, {
            module: true,
            toplevel: true,
            compress: {
              module: true,
              toplevel: true,
              global_defs: {
                // special global that when set to false will remove all dev code entirely
                // developer production builds could use core.min.js directly, or setup
                // their own build tools to define the global `qwikDev` to false
                'globalThis.qDev': false,
                'globalThis.qInspector': false,
                'globalThis.qSerialize': false,
                'globalThis.qDynamicPlatform': false,
                'globalThis.qTest': false,
                'globalThis.qRuntimeQrl': false,
                'globalThis.QWIK_VERSION': JSON.stringify(config.distVersion),
              },
              ecma: 2020,
              passes: 3,
              pure_getters: true,
              unsafe_symbols: true,
              keep_fargs: false,
            },
            mangle: {
              toplevel: true,
              module: true,
              properties: {
                regex: '^\\$.+\\$$',
              },
            },
            format: {
              comments: /__PURE__/,
              preserve_annotations: true,
              ecma: 2020,
            },
          });
          const esmMinCode = esmMinifyResult.code!;
          const esmCleanCode = esmMinCode.replace(/__self__/g, '__SELF__');

          const selfIdx = esmCleanCode.indexOf('self');
          const indx = Math.max(selfIdx);
          if (indx !== -1) {
            throw new Error(
              `"core.min.mjs" should not have any global references, and should have been removed for a production minified build\n` +
                esmCleanCode.substring(indx, indx + 20)
            );
          }
          return {
            code: esmCleanCode,
          };
        },
      },
    ],
  });

  console.log('🐭 core.min.mjs:', await fileSize(join(config.distQwikPkgDir, 'core.min.mjs')));

  // always set the cjs version (probably imported server-side) to dev mode
  let esmCode = await readFile(join(config.distQwikPkgDir, 'core.mjs'), 'utf-8');
  let cjsCode = await readFile(join(config.distQwikPkgDir, 'core.cjs'), 'utf-8');
  await writeFile(join(config.distQwikPkgDir, 'core.cjs'), cjsCode);

  await submoduleCoreProduction(config, esmCode, join(config.distQwikPkgDir, 'core.prod.mjs'));
  await submoduleCoreProduction(config, cjsCode, join(config.distQwikPkgDir, 'core.prod.cjs'));
}

async function submoduleCoreProduction(config: BuildConfig, code: string, outPath: string) {
  const result = await minify(code, {
    compress: {
      pure_getters: true,
      unsafe_symbols: true,
      keep_fargs: false,
      join_vars: false,

      global_defs: {
        'globalThis.qDev': false,
        'globalThis.qInspector': false,
        'globalThis.qSerialize': true,
        'globalThis.qDynamicPlatform': true,
        'globalThis.qTest': false,
        'globalThis.qRuntimeQrl': false,
        'globalThis.QWIK_VERSION': JSON.stringify(config.distVersion),
      },
    },
    format: {
      beautify: true,
      braces: true,
      comments: /__PURE__/,
      preserve_annotations: true,
      ecma: 2020,
      preamble: getBanner('@builder.io/qwik', config.distVersion),
    },
    mangle: false,
  });
  code = result.code!;

  await writeFile(outPath, code + '\n');
}

async function submoduleCoreDev(config: BuildConfig) {
  const submodule = 'core';

  const opts: BuildOptions = {
    entryPoints: [join(config.srcQwikDir, submodule, 'index.ts')],
    entryNames: submodule,
    outdir: config.distQwikPkgDir,
    bundle: true,
    sourcemap: 'external',
    external: ['@builder.io/qwik/build'],
    target,
    define: {
      'globalThis.QWIK_VERSION': JSON.stringify(config.distVersion),
    },
  };

  const esm = build({
    ...opts,
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    watch: watcher(config, submodule),
  });

  const cjs = build({
    ...opts,
    format: 'cjs',
    outExtension: { '.js': '.cjs' },
    watch: watcher(config),
    banner: {
      js: `globalThis.qwikCore = (function (module) {`,
    },
    footer: {
      js: `return module.exports; })(typeof module === 'object' && module.exports ? module : { exports: {} });`,
    },
  });

  await Promise.all([esm, cjs]);

  console.log('🐬', submodule, '(dev)');
}
