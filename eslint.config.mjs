import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "apps/web/**/*.test.ts",
      "apps/web/**/*.test.tsx"
    ]
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        console: "readonly",
        process: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly"
      }
    }
  }
);
