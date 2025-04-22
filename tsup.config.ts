import { defineConfig } from "tsup";

const isDev = process.env.npm_lifecycle_event === "dev";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts"],      // ✅ 단일 진입점만
  minify: !isDev,
  target: "node18",
  outDir: "dist",
  format: ['cjs'],              // ✅ Node 호환성 보장
  bundle: true,
  splitting: false,            // ✅ 청크 금지
  noExternal: [
    "@modelcontextprotocol/sdk",
    "zod"
  ],
  outExtension: ({ format }) => ({
    js: ".js",
  }),
  // ✅ cli.js 실행 제거! → Render에서는 index.js만 실행해야 함
  onSuccess: undefined
});
