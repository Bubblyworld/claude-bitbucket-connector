import "dotenv/config";

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
  bitbucketKey: required("BITBUCKET_KEY"),
  bitbucketSecret: required("BITBUCKET_SECRET"),
  jwtSecret: required("JWT_SECRET"),
};
