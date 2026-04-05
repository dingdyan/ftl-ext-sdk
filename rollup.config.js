import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

// Firefox ArrayBuffer fix for Tampermonkey
// Firefox has a cross-realm instanceof ArrayBuffer failure that affects
// content scripts and userscripts. This patch replaces instanceof checks
// with duck typing to work around the issue.
function firefoxArrayBufferFix() {
  return {
    name: 'firefox-arraybuffer-fix',
    renderChunk(code) {
      // Replace instanceof ArrayBuffer checks with duck typing
      // This is a simplified version - in production you'd want more robust handling
      return code.replace(
        /instanceof ArrayBuffer/g,
        'typeof value === "object" && value !== null && Object.prototype.toString.call(value) === "[object ArrayBuffer]"'
      );
    },
  };
}

export default {
  input: 'src/index.js',
  output: [
    {
      file: 'dist/ftl-ext-sdk.bundle.js',
      format: 'umd',
      name: 'FTL',
      sourcemap: true,
      plugins: [firefoxArrayBufferFix()],
    },
    {
      file: 'dist/ftl-ext-sdk.bundle.min.js',
      format: 'umd',
      name: 'FTL',
      sourcemap: true,
      plugins: [terser(), firefoxArrayBufferFix()],
    },
  ],
  plugins: [
    resolve({ browser: true }),
    commonjs(),
  ],
};
