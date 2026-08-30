const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on("error", (err) => console.error("Erro de conexão com Redis:", err.message));

// Usado para: cache do ranking semanal, cache de notícias em destaque,
// e como store de rate limiting (ver middleware/rateLimit.js).
module.exports = redis;
