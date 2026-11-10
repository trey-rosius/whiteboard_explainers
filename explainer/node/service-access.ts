/**
 * The API requires sign-in. Repo scripts (CLI, cloud tests) can't do a passkey, so they send the service token
 * instead. It lives in Secrets Manager, so only someone with AWS access to this account can use it. Import first.
 */
import { registerMiddleware } from '@aws-blocks/core/client';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const secret = await new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' })
  .send(new GetSecretValueCommand({ SecretId: 'video-explainer/progress-token' }));

registerMiddleware({
  onRequest: (request: any) => ({ ...request, headers: { ...request.headers, 'x-service-token': secret.SecretString } }),
});
