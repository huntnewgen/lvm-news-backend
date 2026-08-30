const express = require("express");
const { body, validationResult } = require("express-validator");
const { query, withTransaction } = require("../config/database");
const { autenticar, autenticarOpcional } = require("../middleware/auth");
const { exigirPermissao } = require("../middleware/permissoes");
const { registrarLog } = require("../utils/adminLog");

const router = express.Router();

/**
 * GET /api/noticias
 * Público: lista apenas notícias aprovadas. Suporta filtro por categoria.
 */
router.get("/", autenticarOpcional, async (req, res, next) => {
  const { categoria, pagina = 1, limite = 12 } = req.query;
  const offset = (Number(pagina) - 1) * Number(limite);

  try {
    const params = [Number(limite), offset];
    let filtro = "WHERE aprovado = true";
    if (categoria) {
      params.push(categoria);
      filtro += ` AND categoria = $${params.length}`;
    }

    const { rows } = await query(
      `SELECT id_noticia, titulo, subtitulo, categoria, autor_id, data_publicacao,
              imagens, tags, versao_audio, versao_libras, versao_leitura_simples
       FROM noticias
       ${filtro}
       ORDER BY data_publicacao DESC
       LIMIT $1 OFFSET $2`,
      params
    );
    res.json({ noticias: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/noticias/pendentes
 * Painel editorial: lista matérias aguardando aprovação.
 * Requer permissão de aprovação (professor, secretaria*, diretoria).
 */
router.get("/pendentes", autenticar, exigirPermissao("acesso_editorial"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT n.id_noticia, n.titulo, n.subtitulo, n.categoria, n.data_criacao,
              n.score_plagio, u.nome AS autor_nome, u.tipo_usuario AS autor_tipo
       FROM noticias n
       JOIN usuarios u ON u.id_usuario = n.autor_id
       WHERE n.aprovado = false
       ORDER BY n.data_criacao ASC`
    );
    res.json({ pendentes: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/noticias/:id
 */
router.get("/:id", autenticarOpcional, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM noticias WHERE id_noticia = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ erro: "Notícia não encontrada." });

    const noticia = rows[0];
    const podeVerNaoAprovada = req.usuario && noticia.autor_id === req.usuario.sub;
    if (!noticia.aprovado && !podeVerNaoAprovada) {
      return res.status(404).json({ erro: "Notícia não encontrada." });
    }
    res.json({ noticia });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/noticias
 * Cria uma matéria como rascunho pendente de aprovação.
 * Qualquer usuário com acesso_editorial pode criar (professor/secretaria/diretoria).
 * Alunos-jornalistas: ver rota /api/noticias/submissao-aluno abaixo.
 */
router.post(
  "/",
  autenticar,
  exigirPermissao("acesso_editorial"),
  [
    body("titulo").trim().isLength({ min: 5, max: 200 }),
    body("categoria").isIn(["escola", "sao_paulo", "cultura", "esporte", "outro"]),
    body("texto").trim().isLength({ min: 20 }),
  ],
  async (req, res, next) => {
    const erros = validationResult(req);
    if (!erros.isEmpty()) return res.status(400).json({ erros: erros.array() });

    const { titulo, subtitulo, categoria, texto, imagens = [], tags = [] } = req.body;

    // Diretoria e secretaria publicam direto; professor também precisa de revisão
    // por outro editor por padrão — ajuste essa regra conforme o fluxo real da escola.
    const publicaDireto = ["diretoria", "secretaria"].includes(req.usuario.tipo_usuario);

    try {
      const { rows } = await query(
        `INSERT INTO noticias (titulo, subtitulo, categoria, texto, autor_id, imagens, tags, aprovado, data_publicacao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          titulo,
          subtitulo || null,
          categoria,
          texto,
          req.usuario.sub,
          imagens,
          tags,
          publicaDireto,
          publicaDireto ? new Date() : null,
        ]
      );
      res.status(201).json({ noticia: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/noticias/:id/aprovar
 * Aprova e publica uma matéria pendente.
 */
router.post("/:id/aprovar", autenticar, exigirPermissao("acesso_aprovacao"), async (req, res, next) => {
  try {
    const resultado = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE noticias SET aprovado = true, aprovado_por = $1, data_publicacao = now()
         WHERE id_noticia = $2 AND aprovado = false
         RETURNING *`,
        [req.usuario.sub, req.params.id]
      );
      if (!rows[0]) throw { status: 404, message: "Notícia não encontrada ou já aprovada." };

      await client.query(
        `INSERT INTO logs_administrativos (id_usuario, acao, detalhes, ip_origem)
         VALUES ($1, 'aprovar_noticia', $2, $3)`,
        [req.usuario.sub, JSON.stringify({ id_noticia: req.params.id }), req.ip]
      );
      return rows[0];
    });

    res.json({ noticia: resultado });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    next(err);
  }
});

/**
 * POST /api/noticias/:id/recusar
 */
router.post("/:id/recusar", autenticar, exigirPermissao("acesso_aprovacao"), async (req, res, next) => {
  const { motivo } = req.body;
  try {
    const { rows } = await query("DELETE FROM noticias WHERE id_noticia = $1 AND aprovado = false RETURNING id_noticia", [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ erro: "Notícia não encontrada ou já aprovada." });

    await registrarLog({
      idUsuario: req.usuario.sub,
      acao: "recusar_noticia",
      detalhes: { id_noticia: req.params.id, motivo: motivo || null },
      ip: req.ip,
    });

    res.json({ mensagem: "Notícia recusada e removida da fila de aprovação." });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/noticias/:id/denunciar
 * Qualquer usuário autenticado pode denunciar uma notícia publicada.
 */
router.post("/:id/denunciar", autenticar, async (req, res, next) => {
  try {
    const { rows } = await query(
      "UPDATE noticias SET denuncias_count = denuncias_count + 1 WHERE id_noticia = $1 RETURNING denuncias_count",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erro: "Notícia não encontrada." });
    res.json({ mensagem: "Denúncia registrada. A equipe de moderação vai revisar.", denuncias_count: rows[0].denuncias_count });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
