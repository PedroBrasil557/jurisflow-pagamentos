import { config } from 'dotenv';

const env = process.env.DEPLOY_ENV ?? '';

const envPath = env === 'prod' ? './.env.prod' : './.env.dev';

config({
  path: envPath,
});
