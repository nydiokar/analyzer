module.exports = {
  apps : [{
    name        : "sova-backend-api",
    script      : "dist/main.js",     // Path to your NestJS entry point
    node_args   : "-r tsconfig-paths/register --max-old-space-size=6144", // path aliases + 6G heap for large similarity jobs
    watch       : false,
    max_memory_restart : '6G',       // raised from 2G — large similarity jobs peak ~2.3GB RSS
    env: {
       TS_NODE_BASEURL: "./dist",   // Always required — tells tsconfig-paths to resolve aliases in dist/
    },
    env_production: {
       NODE_ENV: "production",
       PORT: 3001,
       TS_NODE_BASEURL: "./dist",
    }
  }]
}; 
