const jwt = require("jsonwebtoken");

/**
 * Exige um Bearer token válido. Popula req.usuario com { sub, tipo_usuario, nome }.
 */
function autenticar(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ erro: "Token de acesso ausente ou mal formatado." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = payload; // { sub, tipo_usuario, nome, iat, exp }
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
    }
    return res.status(401).json({ erro: "Token inválido." });
  }
}

/**
 * Middleware opcional: não bloqueia se não houver token, mas popula req.usuario se houver.
 * Útil para rotas públicas que mudam de comportamento se o usuário estiver logado.
 */
function autenticarOpcional(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) {
    try {
      req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      // token inválido/expirado: segue como visitante anônimo
    }
  }
  next();
}

module.exports = { autenticar, autenticarOpcional };
