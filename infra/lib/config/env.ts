const isProd = process.env.ENVIRONMENT === "prod";

export const env = {
  envName: process.env.ENVIRONMENT ?? "",
  isProd,
  slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",
  domainCertificateArn: process.env.DOMAIN_CERTIFICATE_ARN ?? "",
  apiDomainName: isProd
    ? "hk9iayyyce.execute-api.us-east-1.amazonaws.com"
    : "bq81uw2pw0.execute-api.us-east-1.amazonaws.com",
  webDomainNames: isProd
    ? ["jurisflow.icsf.com.br"]
    : ["dev.jurisflow.icsf.com.br"],
};
