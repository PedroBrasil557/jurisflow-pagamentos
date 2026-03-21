const isProd = process.env.ENVIRONMENT === 'prod';

export const env = {
  envName: process.env.ENVIRONMENT ?? '',
  isProd,
  slackBotToken: process.env.SLACK_BOT_TOKEN ?? '',
  domainCertificateArn: process.env.DOMAIN_CERTIFICATE_ARN ?? '',
  apiDomainName: isProd
    ? 'PLACEHOLDER'
    : 'bq81uw2pw0.execute-api.us-east-1.amazonaws.com',
  webDomainNames: isProd
    ? ['PLACEHOLDER']
    : ['d1son9ku39ox5g.cloudfront.net'],
};
