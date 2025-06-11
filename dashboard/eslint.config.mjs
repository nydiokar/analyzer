import nextPlugin from "next/core-web-vitals";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  // Base configuration
  {
    ignores: [".next/**"],
  },
  // Next.js recommended configuration
  nextPlugin,
  // You can add more rules or overrides here in separate objects
  // Example:
  // {
  //   files: ["src/app/**/*.ts?(x)"],
  //   rules: { "no-console": "warn" }
  // }
];

export default eslintConfig;
