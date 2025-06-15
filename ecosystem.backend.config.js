module.exports = {
  apps : [{
    name        : "sova-backend-api",
    script      : "dist/main.js",     // Path to your NestJS entry point
    node_args   : "-r tsconfig-paths/register", // Crucial for resolving path aliases
    watch       : false,
    max_memory_restart : '1G',       // Optional: restart if it exceeds memory
    env_production: {                // Environment variables for production
       NODE_ENV: "production",
       PORT: 3001,
       TS_NODE_BASEURL: "./dist", // Tells tsconfig-paths where compiled files are
       // DATABASE_URL should be set in a .env file
    }
  }]
}; 