const { query } = require("../config/database");

// Cache simples em memória da matriz de permissões (muda raramente).
let cachePermissoes = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function carregarPermissoes() {
  const agora = Date.now();
  if (cachePermissoes && agora - cacheTimestamp < CACHE_TTL_MS) {
    return cachePermissoes;
  }
  const { rows } = await query("SELECT * FROM permissoes");
  cachePermissoes = Object.fromEntries(rows.map((r) => [r.tipo_usuario, r]));
  cacheTimestamp = agora;
  return cachePermissoes;
}

/**
 * Middleware factory: exige que o usuário autenticado tenha a coluna de
 * permissão informada como true (ou tenha acesso_total).
 *
 * Uso: router.post('/noticias', autenticar, exigirPermissao('acesso_editorial'), handler)
 */
function exigirPermissao(coluna) {
  return async (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ erro: "Autenticação necessária." });
    }
    try {
      const permissoes = await carregarPermissoes();
      const perfil = permissoes[req.usuario.tipo_usuario];

      if (!perfil) {
        return res.status(403).json({ erro: "Tipo de usuário sem permissões configuradas." });
      }
      if (perfil.acesso_total || perfil[coluna]) {
        return next();
      }
      return res.status(403).json({
        erro: `Acesso negado. Esta ação requer a permissão '${coluna}'.`,
      });
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Restringe por lista explícita de tipos de usuário — útil quando a regra
 * não é "tem permissão X", mas "só diretoria" mesmo.
 * Uso: exigirTipo('diretoria')  ou  exigirTipo('diretoria', 'secretaria')
 */
function exigirTipo(...tiposPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ erro: "Autenticação necessária." });
    }
    if (!tiposPermitidos.includes(req.usuario.tipo_usuario)) {
      return res.status(403).json({
        erro: `Acesso restrito a: ${tiposPermitidos.join(", ")}.`,
      });
    }
    next();
  };
}

module.exports = { exigirPermissao, exigirTipo, carregarPermissoes };
