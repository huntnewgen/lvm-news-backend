const express = require("express");
const { body, validationResult } = require("express-validator");
const { query } = require("../config/database");
const { autenticar } = require("../middleware/auth");
const { exigirPermissao } = require("../middleware/permissoes");
const { registrarLog } = require("../utils/adminLog");

const router = express.Router();

/**
 * GET /api/usuarios/me
 * Perfil do usuário autenticado, incluindo conquistas e estatísticas.
 */
router.get("/me", autenticar, async (req, res, next) => {
  try {
    const { rows: usuarioRows } = await query(
      `SELECT id_usuario, nome, email, tipo_usuario, ra, turma, foto_perfil, biografia,
              xp, nivel, acessibilidade_tipo, preferencias_acessibilidade, tema_preferido
       FROM usuarios WHERE id_usuario = $1`,
      [req.usuario.sub]
    );
    if (!usuarioRows[0]) return res.status(404).json({ erro: "Usuário não encontrado." });

    const { rows: conquistas } = await query(
      `SELECT c.nome, c.descricao, c.icone, cu.data_recebida
       FROM conquistas_usuarios cu
       JOIN conquistas c ON c.id_conquista = cu.id_conquista
       WHERE cu.id_usuario = $1`,
      [req.usuario.sub]
    );

    const { rows: estatRows } = await query("SELECT * FROM estatisticas WHERE id_usuario = $1", [req.usuario.sub]);

    res.json({ usuario: usuarioRows[0], conquistas, estatisticas: estatRows[0] || null });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/usuarios/me/preferencias
 * Atualiza tema, tipo de acessibilidade e preferências (alto contraste, narrador etc).
 */
router.patch(
  "/me/preferencias",
  autenticar,
  [
    body("tema_preferido").optional().isIn(["claro", "escuro"]),
    body("acessibilidade_tipo").optional().isIn(["nenhuma", "surdo", "cego", "mudo", "multipla"]),
    body("preferencias_acessibilidade").optional().isObject(),
  ],
  async (req, res, next) => {
    const erros = validationResult(req);
    if (!erros.isEmpty()) return res.status(400).json({ erros: erros.array() });

    const { tema_preferido, acessibilidade_tipo, preferencias_acessibilidade } = req.body;

    try {
      const { rows } = await query(
        `UPDATE usuarios SET
           tema_preferido = COALESCE($1, tema_preferido),
           acessibilidade_tipo = COALESCE($2, acessibilidade_tipo),
           preferencias_acessibilidade = COALESCE($3, preferencias_acessibilidade)
         WHERE id_usuario = $4
         RETURNING tema_preferido, acessibilidade_tipo, preferencias_acessibilidade`,
        [tema_preferido, acessibilidade_tipo, preferencias_acessibilidade, req.usuario.sub]
      );
      res.json({ preferencias: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/usuarios/ranking
 * Top usuários por XP (ranking semanal simplificado — em produção, filtrar por
 * janela de tempo usando um snapshot semanal em vez do xp acumulado total).
 */
router.get("/ranking", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT nome, turma, xp FROM usuarios WHERE tipo_usuario = 'aluno' ORDER BY xp DESC LIMIT 10`
    );
    res.json({ ranking: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/usuarios
 * Gerenciamento de usuários — restrito à diretoria.
 */
router.get("/", autenticar, exigirPermissao("acesso_gerenciar_usuarios"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id_usuario, nome, email, tipo_usuario, ra, turma, ativo, ultimo_login, data_criacao
       FROM usuarios ORDER BY data_criacao DESC`
    );
    res.json({ usuarios: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/usuarios/:id/status
 * Ativa/desativa uma conta — restrito à diretoria.
 */
router.patch("/:id/status", autenticar, exigirPermissao("acesso_gerenciar_usuarios"), async (req, res, next) => {
  const { ativo } = req.body;
  if (typeof ativo !== "boolean") return res.status(400).json({ erro: "Campo 'ativo' deve ser booleano." });

  try {
    const { rows } = await query("UPDATE usuarios SET ativo = $1 WHERE id_usuario = $2 RETURNING id_usuario, ativo", [
      ativo,
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ erro: "Usuário não encontrado." });

    await registrarLog({
      idUsuario: req.usuario.sub,
      acao: ativo ? "reativar_usuario" : "desativar_usuario",
      detalhes: { id_usuario_alvo: req.params.id },
      ip: req.ip,
    });

    res.json({ usuario: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
