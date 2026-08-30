const express = require("express");
const { body, validationResult } = require("express-validator");
const { query } = require("../config/database");
const { autenticar } = require("../middleware/auth");
const { exigirPermissao } = require("../middleware/permissoes");
const { registrarLog } = require("../utils/adminLog");

const router = express.Router();

/**
 * GET /api/comentarios/noticia/:idNoticia
 */
router.get("/noticia/:idNoticia", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id_comentario, c.texto, c.reacao_emoji, c.data_hora, u.nome, u.turma
       FROM comentarios c
       JOIN usuarios u ON u.id_usuario = c.id_usuario
       WHERE c.id_noticia = $1 AND c.moderado = false
       ORDER BY c.data_hora ASC`,
      [req.params.idNoticia]
    );
    res.json({ comentarios: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/comentarios
 * Aceita texto e/ou reação de emoji — o campo de texto é opcional para
 * atender ao modo de acessibilidade "mudo" (resposta só por emoji/reação rápida).
 */
router.post(
  "/",
  autenticar,
  [
    body("id_noticia").isUUID(),
    body("texto").optional().trim().isLength({ max: 1000 }),
    body("reacao_emoji").optional().trim().isLength({ max: 10 }),
  ],
  async (req, res, next) => {
    const erros = validationResult(req);
    if (!erros.isEmpty()) return res.status(400).json({ erros: erros.array() });

    const { id_noticia, texto, reacao_emoji } = req.body;
    if (!texto && !reacao_emoji) {
      return res.status(400).json({ erro: "Envie um texto ou uma reação de emoji." });
    }

    try {
      const { rows } = await query(
        `INSERT INTO comentarios (id_usuario, id_noticia, texto, reacao_emoji)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.usuario.sub, id_noticia, texto || null, reacao_emoji || null]
      );

      // Gamificação: +5 XP por comentário, atualiza estatísticas do usuário
      await query(
        `UPDATE usuarios SET xp = xp + 5 WHERE id_usuario = $1`,
        [req.usuario.sub]
      );
      await query(
        `INSERT INTO estatisticas (id_usuario, comentarios_feitos)
         VALUES ($1, 1)
         ON CONFLICT (id_usuario) DO UPDATE SET comentarios_feitos = estatisticas.comentarios_feitos + 1`,
        [req.usuario.sub]
      );

      res.status(201).json({ comentario: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/comentarios/:id/denunciar
 */
router.post("/:id/denunciar", autenticar, async (req, res, next) => {
  try {
    const { rows } = await query(
      "UPDATE comentarios SET denunciado = true WHERE id_comentario = $1 RETURNING id_comentario",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erro: "Comentário não encontrado." });
    res.json({ mensagem: "Comentário denunciado para moderação." });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/comentarios/:id/moderar
 * Remove um comentário da visualização pública (soft-delete via flag `moderado`).
 * Requer permissão de moderação (secretaria ou diretoria).
 */
router.post("/:id/moderar", autenticar, exigirPermissao("acesso_moderacao"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "UPDATE comentarios SET moderado = true, moderado_por = $1 WHERE id_comentario = $2 RETURNING id_comentario",
      [req.usuario.sub, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erro: "Comentário não encontrado." });

    await registrarLog({
      idUsuario: req.usuario.sub,
      acao: "moderar_comentario",
      detalhes: { id_comentario: req.params.id },
      ip: req.ip,
    });

    res.json({ mensagem: "Comentário removido da visualização pública." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
