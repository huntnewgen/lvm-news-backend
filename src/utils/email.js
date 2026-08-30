const crypto = require("crypto");

/**
 * Gera um token de verificação seguro e sua data de expiração (24h).
 */
function gerarTokenVerificacao() {
  const token = crypto.randomBytes(32).toString("hex");
  const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return { token, expira };
}

/**
 * Envia o e-mail de confirmação de cadastro.
 *
 * Este é um STUB: por padrão só loga no console, para você poder testar o
 * fluxo sem depender de um provedor de e-mail configurado. Em produção,
 * troque o corpo desta função por uma chamada real — por exemplo Resend,
 * SendGrid ou Amazon SES. A assinatura da função não muda para o resto
 * do backend.
 *
 * Exemplo com Resend (https://resend.com):
 *
 *   const { Resend } = require('resend');
 *   const resend = new Resend(process.env.RESEND_API_KEY);
 *   await resend.emails.send({
 *     from: 'LVM News <contato@lvmnews.com.br>',
 *     to: email,
 *     subject: 'Confirme seu e-mail — LVM News',
 *     html: `<p>Clique para confirmar: <a href="${linkConfirmacao}">${linkConfirmacao}</a></p>`,
 *   });
 */
async function enviarEmailConfirmacao({ email, nome, token }) {
  const linkConfirmacao = `${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}/confirmar-email?token=${token}`;

  if (process.env.NODE_ENV !== "production") {
    console.log("── E-mail de confirmação (modo dev, não enviado de verdade) ──");
    console.log(`Para: ${email}`);
    console.log(`Olá, ${nome}! Confirme seu cadastro no LVM News:`);
    console.log(linkConfirmacao);
    console.log("────────────────────────────────────────────────────────────");
    return { simulado: true };
  }

  throw new Error(
    "Nenhum provedor de e-mail configurado. Implemente enviarEmailConfirmacao() " +
      "em src/utils/email.js com Resend, SendGrid ou similar antes de usar em produção."
  );
}

module.exports = { gerarTokenVerificacao, enviarEmailConfirmacao };
