import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const client = new SecretsManagerClient({});
const ssm = new SSMClient({});
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

/** An SSM String parameter's value (e.g. the live-coach pilot list /call-coach/realtime-agents). */
export async function getParameterString(name: string): Promise<string> {
  const res = await ssm.send(new GetParameterCommand({ Name: name }));
  return res.Parameter?.Value ?? '';
}

/** The raw SecretString of a separate secret (e.g. call-coach/ai-gateway, the live-coach key). */
export async function getSecretString(secretArn: string | undefined): Promise<string> {
  if (!secretArn) return '';
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  return res.SecretString ?? '';
}
