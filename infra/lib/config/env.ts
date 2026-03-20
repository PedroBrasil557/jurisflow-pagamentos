const isProd = process.env.ENVIRONMENT === 'prod';

export const env = {
  envName: process.env.ENVIRONMENT ?? '',
  isProd,
  slackBotToken: process.env.SLACK_BOT_TOKEN ?? '',
  domainCertificateArn: process.env.DOMAIN_CERTIFICATE_ARN ?? '',
  apiDomainName: 'PLACEHOLDER', // TODO: preencher com domínio real
  webDomainNames: ['PLACEHOLDER'], // TODO: preencher com domínio(s) real(is)
};
