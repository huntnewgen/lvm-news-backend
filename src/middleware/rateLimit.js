const rateLimit = require("express-rate-limit");

// Limite geral de API
const limiteGeral = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Muitas requisições. Tente novamente em alguns minutos." },
});

// Limite mais rígido para login, prevenindo força bruta contra senhas
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Muitas tentativas de login. Aguarde 15 minutos." },
});

module.exports = { limiteGeral, limiteLogin };
