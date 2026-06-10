const isProd = process.env.ENVIRONMENT === "prod";

// Token compartilhado entre API e Worker. NUNCA pode ir vazio para o container:
// o env.ts da API valida com z.string().min(1), entao "" derrubaria a API no
// boot. Em producao e obrigatorio (falha o synth se ausente); fora de producao,
// usa o mesmo default do dev da API.
function resolveInternalApiToken(): string {
  const token = process.env.INTERNAL_API_TOKEN;
  if (token && token.length > 0) return token;
  if (isProd) {
    throw new Error(
      "INTERNAL_API_TOKEN e obrigatorio em producao. Defina o GitHub secret INTERNAL_API_TOKEN_PROD.",
    );
  }
  return "dev-internal-token-change-me";
}

export const env = {
  envName: process.env.ENVIRONMENT ?? "",
  isProd,
  internalApiToken: resolveInternalApiToken(),
  slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",
  domainCertificateArn: process.env.DOMAIN_CERTIFICATE_ARN ?? "",
  apiDomainName: isProd
    ? "hk9iayyyce.execute-api.us-east-1.amazonaws.com"
    : "bq81uw2pw0.execute-api.us-east-1.amazonaws.com",
  webDomainNames: isProd
    ? ["jurisflow.icsf.com.br"]
    : ["dev.jurisflow.icsf.com.br"],
};
