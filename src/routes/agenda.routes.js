const express = require("express");
const { body, validationResult } = require("express-validator");
const { query } = require("../config/database");
const { autenticar } = require("../middleware/auth");
const { exigirPermissao } = require("../middleware/permissoes");

const router = express.Router();

/**
 * GET /api/agenda
 * Pública para leitura — todo mundo vê a agenda escolar.
 */
router.get("/", async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT * FROM agenda_escolar WHERE data_evento >= now() ORDER BY data_evento ASC"
    );
    res.json({ eventos: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agenda
 * Criar evento — restrito a secretaria e diretoria.
 */
router.post(
  "/",
  autenticar,
  exigirPermissao("acesso_agenda"),
  [body("titulo").trim().notEmpty(), body("data_evento").isISO8601()],
  async (req, res, next) => {
    const erros = validationResult(req);
    if (!erros.isEmpty()) return res.status(400).json({ erros: erros.array() });

    const { titulo, descricao, data_evento, local } = req.body;
    try {
      const { rows } = await query(
        `INSERT INTO agenda_escolar (titulo, descricao, data_evento, local, criado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [titulo, descricao || null, data_evento, local || null, req.usuario.sub]
      );
      res.status(201).json({ evento: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
