import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});
let cachedSecrets: Record<string, string> | null = null;

export async function getSecret(key: string): Promise<string> {
  if (!cachedSecrets) {
    const res = await client.send(new GetSecretValueCommand({
      SecretId: process.env.API_KEYS_SECRET_ARN,
    }));
    cachedSecrets = JSON.parse(res.SecretString!);
  }
  return cachedSecrets![key];
}
