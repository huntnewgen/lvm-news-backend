const express = require("express");
const bcrypt = require("bcrypt");
const { body, validationResult } = require("express-validator");
const { query } = require("../config/database");
const { gerarAccessToken, gerarRefreshToken, verificarRefreshToken } = require("../utils/tokens");
const { limiteLogin } = require("../middleware/rateLimit");
const { registrarLog } = require("../utils/adminLog");
const { gerarTokenVerificacao, enviarEmailConfirmacao } = require("../utils/email");

const router = express.Router();
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;

/**
 * POST /api/auth/login
 * Login unificado: alunos entram com RA, os demais com credencial institucional.
 * Corpo: { identificador: "RA123456" | "PROF-4821", senha: "..." }
 */
router.post(
  "/login",
  limiteLogin,
  [body("identificador").trim().notEmpty(), body("senha").notEmpty()],
  async (req, res, next) => {
    const erros = validationResult(req);
    if (!erros.isEmpty()) {
      return res.status(400).json({ erro: "Identificador e senha são obrigatórios." });
    }

    const { identificador, senha } = req.body;

    try {
      const { rows } = await query(
        `SELECT * FROM usuarios
         WHERE (ra = $1 OR credencial_institucional = $1) AND ativo = true`,
        [identificador]
      );
      const usuario = rows[0];

      // Mensagem genérica de propósito — não revela se o identificador existe,
      // para não dar pista a quem tenta adivinhar RAs/credenciais válidos.
      if (!usuario) {
        return res.status(401).json({ erro: "Credenciais inválidas." });
      }

      const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
      if (!senhaValida) {
        return res.status(401).json({ erro: "Credenciais inválidas." });
      }

      if (!usuario.email_verificado) {
        return res.status(403).json({
          erro: "E-mail ainda não confirmado. Verifique sua caixa de entrada.",
          email_pendente: true,
        });
      }

      await query("UPDATE usuarios SET ultimo_login = now() WHERE id_usuario = $1", [usuario.id_usuario]);

      const accessToken = gerarAccessToken(usuario);
      const refreshToken = gerarRefreshToken(usuario);

      res.json({
        accessToken,
        refreshToken,
        usuario: {
          id_usuario: usuario.id_usuario,
          nome: usuario.nome,
          tipo_usuario: usuario.tipo_usuario,
          turma: usuario.turma,
          foto_perfil: usuario.foto_perfil,
          tema_preferido: usuario.tema_preferido,
          acessibilidade_tipo: usuario.acessibilidade_tipo,
          preferencias_acessibilidade: usuario.preferencias_acessibilidade,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/registrar-aluno
 * Autocadastro de aluno com RA (validação de RA existente na rede escolar
 * é responsabilidade de uma integração futura com o sistema da secretaria;
 * aqui apenas garantimos unicidade no banco do jornal).
 * Turma esperada no formato "1º", "2º" ou "3º" + letra (ensino médio only).
 * A conta fica inativa para login até o e-mail ser confirmado.
 */
router.post(
  "/registrar-aluno",
  [
    body("nome").trim().isLength({ min: 3 }),
    body("email").isEmail(),
    body("ra").trim().notEmpty(),
    body("turma").trim().matches(/^[123]º[A-Z]$/).withMessage("Turma deve ser 1º, 2º ou 3º ano (ex: 2ºB)."),
    body("senha").isLength({ min: 8 }).withMessage("A senha precisa ter ao menos 8 caracteres."),
  ],
  async (req, res, next) => {
    const erros = validationResult(req);
    if (!erros.isEmpty()) {
      return res.status(400).json({ erros: erros.array() });
    }

    const { nome, email, ra, turma, senha } = req.body;

    try {
      const senha_hash = await bcrypt.hash(senha, SALT_ROUNDS);
      const { token, expira } = gerarTokenVerificacao();

      const { rows } = await query(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, ra, turma, token_verificacao, token_verificacao_expira)
         VALUES ($1, $2, $3, 'aluno', $4, $5, $6, $7)
         RETURNING id_usuario, nome, tipo_usuario, ra, turma`,
        [nome, email, senha_hash, ra, turma, token, expira]
      );

      await enviarEmailConfirmacao({ email, nome, token });

      res.status(201).json({
        usuario: rows[0],
        mensagem: "Cadastro criado. Confirme seu e-mail para poder fazer login.",
      });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ erro: "E-mail ou RA já cadastrado." });
      }
      next(err);
    }
  }
);

/**
 * POST /api/auth/registrar-equipe
 * Autocadastro de professor, secretaria ou diretoria. Como a escola é só
 * ensino médio, os três papéis têm o mesmo nível de acesso (ver tabela
 * `permissoes`) — o campo tipo_usuario aqui serve só de identificação/registro,
 * não muda o que a pessoa pode fazer no sistema.
 * A conta fica inativa para login até o e-mail ser confirmado.
 */
router.post(
  "/registrar-equipe",
  [
    body("nome").trim().isLength({ min: 3 }),
    body("email").isEmail(),
    body("usuario").trim().isLength({ min: 3 }).withMessage("Escolha um nome de usuário com ao menos 3 caracteres."),
    body("tipo_usuario").isIn(["professor", "secretaria", "diretoria"]),
    body("senha").isLength({ min: 8 }),
  ],
  async (req, res, next) => {
    const erros = validationResult(req);
    if (!erros.isEmpty()) {
      return res.status(400).json({ erros: erros.array() });
    }

    const { nome, email, usuario: nomeUsuario, tipo_usuario, senha } = req.body;

    try {
      const senha_hash = await bcrypt.hash(senha, SALT_ROUNDS);
      const { token, expira } = gerarTokenVerificacao();

      const { rows } = await query(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, credencial_institucional, token_verificacao, token_verificacao_expira)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id_usuario, nome, tipo_usuario`,
        [nome, email, senha_hash, tipo_usuario, nomeUsuario, token, expira]
      );

      await enviarEmailConfirmacao({ email, nome, token });

      res.status(201).json({
        usuario: rows[0],
        mensagem: "Cadastro criado. Confirme seu e-mail para poder fazer login.",
      });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ erro: "E-mail ou nome de usuário já cadastrado." });
      }
      next(err);
    }
  }
);

/**
 * GET /api/auth/confirmar-email/:token
 * Chamado pelo link enviado por e-mail. Ativa a conta para login.
 */
router.get("/confirmar-email/:token", async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE usuarios SET email_verificado = true, token_verificacao = NULL, token_verificacao_expira = NULL
       WHERE token_verificacao = $1 AND token_verificacao_expira > now()
       RETURNING id_usuario, nome, email`,
      [req.params.token]
    );
    if (!rows[0]) {
      return res.status(400).json({ erro: "Link de confirmação inválido ou expirado. Solicite um novo." });
    }
    res.json({ mensagem: "E-mail confirmado! Você já pode fazer login.", usuario: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/reenviar-confirmacao
 * Corpo: { email }
 */
router.post("/reenviar-confirmacao", [body("email").isEmail()], async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT id_usuario, nome, email FROM usuarios WHERE email = $1 AND email_verificado = false",
      [req.body.email]
    );
    // Resposta genérica mesmo se não encontrar, para não confirmar quais e-mails existem
    if (!rows[0]) {
      return res.json({ mensagem: "Se o e-mail estiver cadastrado e pendente, reenviamos a confirmação." });
    }
    const { token, expira } = gerarTokenVerificacao();
    await query("UPDATE usuarios SET token_verificacao = $1, token_verificacao_expira = $2 WHERE id_usuario = $3", [
      token,
      expira,
      rows[0].id_usuario,
    ]);
    await enviarEmailConfirmacao({ email: rows[0].email, nome: rows[0].nome, token });
    res.json({ mensagem: "Se o e-mail estiver cadastrado e pendente, reenviamos a confirmação." });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/refresh
 * Troca um refresh token válido por um novo access token, sem exigir login de novo.
 */
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ erro: "refreshToken é obrigatório." });

  try {
    const payload = verificarRefreshToken(refreshToken);
    const { rows } = await query("SELECT * FROM usuarios WHERE id_usuario = $1 AND ativo = true", [payload.sub]);
    const usuario = rows[0];
    if (!usuario) return res.status(401).json({ erro: "Usuário não encontrado ou inativo." });

    res.json({ accessToken: gerarAccessToken(usuario) });
  } catch (err) {
    return res.status(401).json({ erro: "Refresh token inválido ou expirado." });
  }
});

module.exports = router;
