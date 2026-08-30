const express = require("express");
const { query } = require("../config/database");
const { autenticar } = require("../middleware/auth");
const { exigirPermissao } = require("../middleware/permissoes");

const router = express.Router();

/**
 * GET /api/admin/estatisticas
 * Visão geral do sistema — restrito à diretoria.
 */
router.get("/estatisticas", autenticar, exigirPermissao("acesso_estatisticas"), async (req, res, next) => {
  try {
    const [usuarios, noticias, comentarios, pendentes] = await Promise.all([
      query("SELECT tipo_usuario, COUNT(*) FROM usuarios GROUP BY tipo_usuario"),
      query("SELECT categoria, COUNT(*) FROM noticias WHERE aprovado = true GROUP BY categoria"),
      query("SELECT COUNT(*) FROM comentarios WHERE moderado = false"),
      query("SELECT COUNT(*) FROM noticias WHERE aprovado = false"),
    ]);

    res.json({
      usuarios_por_tipo: usuarios.rows,
      noticias_por_categoria: noticias.rows,
      total_comentarios_ativos: Number(comentarios.rows[0].count),
      noticias_pendentes: Number(pendentes.rows[0].count),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/logs
 * Trilha de auditoria — restrito à diretoria.
 */
router.get("/logs", autenticar, exigirPermissao("acesso_configuracoes"), async (req, res, next) => {
  const { limite = 100 } = req.query;
  try {
    const { rows } = await query(
      `SELECT l.id_log, l.acao, l.detalhes, l.ip_origem, l.data_hora, u.nome AS usuario_nome
       FROM logs_administrativos l
       LEFT JOIN usuarios u ON u.id_usuario = l.id_usuario
       ORDER BY l.data_hora DESC
       LIMIT $1`,
      [Number(limite)]
    );
    res.json({ logs: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/permissoes/:tipoUsuario
 * Ajusta a matriz de permissões — restrito à diretoria (acesso_total).
 */
router.patch("/permissoes/:tipoUsuario", autenticar, exigirPermissao("acesso_configuracoes"), async (req, res, next) => {
  const colunasPermitidas = [
    "acesso_leitura", "acesso_comentarios", "acesso_editorial", "acesso_aprovacao",
    "acesso_agenda", "acesso_moderacao", "acesso_estatisticas", "acesso_gerenciar_usuarios",
    "acesso_configuracoes", "acesso_ia_administrativa", "acesso_total",
  ];

  const atualizacoes = Object.entries(req.body).filter(([chave]) => colunasPermitidas.includes(chave));
  if (atualizacoes.length === 0) {
    return res.status(400).json({ erro: "Nenhum campo de permissão válido enviado." });
  }

  const setClause = atualizacoes.map(([chave], i) => `${chave} = $${i + 1}`).join(", ");
  const valores = atualizacoes.map(([, valor]) => valor);

  try {
    const { rows } = await query(
      `UPDATE permissoes SET ${setClause} WHERE tipo_usuario = $${valores.length + 1} RETURNING *`,
      [...valores, req.params.tipoUsuario]
    );
    if (!rows[0]) return res.status(404).json({ erro: "Tipo de usuário não encontrado." });

    await query(
      `INSERT INTO logs_administrativos (id_usuario, acao, detalhes) VALUES ($1, 'alterar_permissao', $2)`,
      [req.usuario.sub, JSON.stringify({ tipo_usuario: req.params.tipoUsuario, alteracoes: req.body })]
    );

    res.json({ permissoes: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
