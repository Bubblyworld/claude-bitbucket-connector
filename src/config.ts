function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  serverUrl: required("SERVER_URL"),
  bitbucketClientId: required("BITBUCKET_CLIENT_ID"),
  bitbucketClientSecret: required("BITBUCKET_CLIENT_SECRET"),
  jwtSecret: required("JWT_SECRET"),
};
