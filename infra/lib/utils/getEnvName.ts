export const getEnvName = (name: string, uppercase = false) => {
  const env = process.env.ENVIRONMENT ?? '';

  const envLabel = uppercase ? env.toUpperCase() : env.toLowerCase();

  return `${name}-${envLabel}`;
};
