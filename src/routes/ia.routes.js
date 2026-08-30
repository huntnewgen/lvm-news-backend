const express = require("express");
const { body, validationResult } = require("express-validator");
const { autenticar } = require("../middleware/auth");
const { exigirPermissao } = require("../middleware/permissoes");
const { query } = require("../config/database");

const router = express.Router();

/**
 * Wrapper fino sobre a API da OpenAI. Troque por Azure Cognitive Services
 * se preferir — só reimplementar esta função mantendo a mesma assinatura.
 * Requer OPENAI_API_KEY no .env.
 */
async function chamarIA(prompt, { maxTokens = 300 } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw { status: 503, message: "IA não configurada: defina OPENAI_API_KEY no servidor." };
  }

  const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.4,
    }),
  });

  if (!resposta.ok) {
    const detalhe = await resposta.text();
    throw { status: 502, message: `Erro na chamada de IA: ${detalhe}` };
  }
  const dados = await resposta.json();
  return dados.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * POST /api/ia/sugerir-titulos
 * Corpo: { texto: "..." }  →  retorna 3 sugestões de título.
 */
router.post(
  "/sugerir-titulos",
  autenticar,
  exigirPermissao("acesso_editorial"),
  [body("texto").trim().isLength({ min: 50 })],
  async (req, res, next) => {
    const erros = validationResult(req);
    if (!erros.isEmpty()) return res.status(400).json({ erros: erros.array() });

    try {
      const saida = await chamarIA(
        `Sugira 3 títulos curtos e chamativos (máx. 12 palavras cada), em português do Brasil, ` +
          `para uma matéria de jornal escolar com o seguinte texto. Responda apenas com uma lista numerada.\n\n${req.body.texto}`
      );
      res.json({ sugestoes: saida });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ erro: err.message });
      next(err);
    }
  }
);

/**
 * POST /api/ia/resumir
 * Gera o resumo automático usado no campo noticias.resumo_ia.
 */
router.post(
  "/resumir",
  autenticar,
  exigirPermissao("acesso_editorial"),
  [body("id_noticia").isUUID(), body("texto").trim().isLength({ min: 50 })],
  async (req, res, next) => {
    try {
      const resumo = await chamarIA(
        `Resuma o texto abaixo em até 3 frases, em português, para leitores do ensino médio:\n\n${req.body.texto}`,
        { maxTokens: 150 }
      );
      await query("UPDATE noticias SET resumo_ia = $1 WHERE id_noticia = $2", [resumo, req.body.id_noticia]);
      res.json({ resumo });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ erro: err.message });
      next(err);
    }
  }
);

/**
 * POST /api/ia/revisar-ortografia
 */
router.post(
  "/revisar-ortografia",
  autenticar,
  exigirPermissao("acesso_editorial"),
  [body("texto").trim().notEmpty()],
  async (req, res, next) => {
    try {
      const revisado = await chamarIA(
        `Revise ortografia e gramática do texto abaixo em português do Brasil, mantendo o estilo do autor. ` +
          `Responda só com o texto corrigido:\n\n${req.body.texto}`,
        { maxTokens: 800 }
      );
      res.json({ texto_revisado: revisado });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ erro: err.message });
      next(err);
    }
  }
);

/**
 * POST /api/ia/detectar-plagio
 * Comparação simplificada por similaridade de texto contra matérias já publicadas.
 * Uma implementação de produção usaria embeddings + busca vetorial (ex: pgvector)
 * em vez de comparação ingênua — aqui documentamos a interface esperada.
 */
router.post(
  "/detectar-plagio",
  autenticar,
  exigirPermissao("acesso_editorial"),
  [body("id_noticia").isUUID(), body("texto").trim().notEmpty()],
  async (req, res, next) => {
    try {
      const { rows } = await query(
        "SELECT id_noticia, titulo, texto FROM noticias WHERE aprovado = true AND id_noticia <> $1 LIMIT 200",
        [req.body.id_noticia]
      );

      const score = maiorSimilaridadeJaccard(req.body.texto, rows.map((r) => r.texto));

      await query("UPDATE noticias SET score_plagio = $1 WHERE id_noticia = $2", [score, req.body.id_noticia]);
      res.json({ score_plagio: score, alerta: score > 40 });
    } catch (err) {
      next(err);
    }
  }
);

// Similaridade de Jaccard sobre conjuntos de palavras — heurística simples e
// rápida de calcular localmente, sem depender de chamada externa de IA.
function maiorSimilaridadeJaccard(textoNovo, textosExistentes) {
  const tokenize = (t) => new Set(t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z]{4,}/g) || []);
  const setNovo = tokenize(textoNovo);
  let maior = 0;
  for (const outro of textosExistentes) {
    const setOutro = tokenize(outro);
    const intersecao = [...setNovo].filter((p) => setOutro.has(p)).length;
    const uniao = new Set([...setNovo, ...setOutro]).size || 1;
    maior = Math.max(maior, (intersecao / uniao) * 100);
  }
  return Math.round(maior * 100) / 100;
}

/**
 * POST /api/ia/moderar-comentario
 * Classifica um comentário como apropriado/inapropriado antes de publicar.
 */
router.post("/moderar-comentario", autenticar, [body("texto").trim().notEmpty()], async (req, res, next) => {
  try {
    const veredito = await chamarIA(
      `Classifique o comentário abaixo, feito por um estudante em um jornal escolar, como "apropriado" ` +
        `ou "inapropriado" (ofensivo, bullying, discurso de ódio ou spam). Responda só com uma palavra.\n\n${req.body.texto}`,
      { maxTokens: 5 }
    );
    res.json({ classificacao: veredito.toLowerCase().includes("inapropriado") ? "inapropriado" : "apropriado" });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    next(err);
  }
});

module.exports = router;
