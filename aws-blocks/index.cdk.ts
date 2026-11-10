import * as cdk from 'aws-cdk-lib';
import {
  aws_cognito as cognito,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_s3 as s3,
} from 'aws-cdk-lib';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Hosting, BlocksStack, BlocksPresets } from '@aws-blocks/blocks/cdk';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync, rmSync } from 'node:fs';
import { getStackName } from '@aws-blocks/blocks/scripts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = new cdk.App();

const sandboxMode = app.node.tryGetContext('sandboxMode') === 'true';
const projectRoot = app.node.tryGetContext('projectRoot') || process.cwd();

const stackName = getStackName({ sandbox: sandboxMode, projectRoot });
export const blocksStack = await BlocksStack.create(app, stackName, {
  backendHandlerPath: join(__dirname, 'index.handler.ts'),
  backendCDKPath: join(__dirname, 'index.ts'),
  defaults: sandboxMode ? BlocksPresets.sandbox : BlocksPresets.production,
});

// ─── Explainer video pipeline (durable Lambda → Remotion Lambda) ───────────────
// Everything renders in the cloud. The Blocks API starts jobs (api: `explainer` namespace);
// names are deterministic so the backend finds them from BLOCKS_STACK_NAME with no extra config.
if (!sandboxMode) {
  const explainerRoot = join(__dirname, '..', 'explainer');
  const account = cdk.Stack.of(blocksStack).account;

  const bucket = new s3.Bucket(blocksStack, 'ExplainerBucket', {
    bucketName: `${stackName}-explainer`,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    encryption: s3.BucketEncryption.S3_MANAGED,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    lifecycleRules: [{ prefix: 'explainer/tts-cache/', expiration: cdk.Duration.days(90) }],
    // Browser uploads of narration takes (presigned, 15-minute, single-object PUTs).
    cors: [{ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: ['*'], allowedHeaders: ['content-type'], maxAge: 3600 }],
  });

  // Icon packs are read from disk at runtime → ship the needed files as a layer (built at synth time).
  const layerDir = join(__dirname, '..', 'out', 'explainer-layer');
  const nm = join(layerDir, 'nodejs', 'node_modules');
  rmSync(layerDir, { recursive: true, force: true });
  const copy = (pkg: string, entries: string[]) =>
    entries.forEach((e) => cpSync(join(__dirname, '..', 'node_modules', pkg, e), join(nm, pkg, e), { recursive: true }));
  copy('lucide-static', ['package.json', 'icons']);
  copy('aws-icons', ['package.json', 'icons']);
  copy('simple-icons', ['package.json', 'index.js', 'index.mjs']);
  const iconLayer = new lambda.LayerVersion(blocksStack, 'ExplainerIconLayer', {
    code: lambda.Code.fromAsset(layerDir),
    compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
    description: 'Icon packs for the explainer video pipeline',
  });

  const pipelineFn = new NodejsFunction(blocksStack, 'ExplainerPipeline', {
    functionName: `${stackName}-explainer`,
    entry: join(explainerRoot, 'pipeline', 'durable-handler.ts'),
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_22_X,
    architecture: lambda.Architecture.ARM_64,
    memorySize: 1024,
    timeout: cdk.Duration.minutes(15),
    // A durable execution stays pinned to the version it started on, possibly for days while waiting for a recording.
    // Deleting that version on deploy hangs the stack and strands the video, so versions are kept.
    currentVersionOptions: { removalPolicy: cdk.RemovalPolicy.RETAIN },
    durableConfig: { executionTimeout: cdk.Duration.days(14), retentionPeriod: cdk.Duration.days(14) },
    layers: [iconLayer],
    projectRoot: join(__dirname, '..'),
    depsLockFilePath: join(__dirname, '..', 'package-lock.json'),
    environment: {
      EXPLAINER_BUCKET: bucket.bucketName,
      BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
      EXPLAINER_SSM_PREFIX: '/video-explainer/',
      QA_VISION: 'true',
      BLOCKS_API_URL: blocksStack.apiUrl,
      PROGRESS_TOKEN_SECRET: 'video-explainer/progress-token',
      NODE_OPTIONS: '--enable-source-maps',
    },
    bundling: {
      format: OutputFormat.ESM,
      target: 'node22',
      mainFields: ['module', 'main'],
      externalModules: ['lucide-static', 'aws-icons', 'simple-icons'],
      loader: { '.md': 'text' },
      banner: "import{createRequire as __bannerCreateRequire}from'module';const require=__bannerCreateRequire(import.meta.url);",
      sourceMap: true,
    },
  });
  const pipelineAlias = new lambda.Alias(blocksStack, 'ExplainerPipelineProd', { aliasName: 'prod', version: pipelineFn.currentVersion });

  bucket.grantReadWrite(pipelineFn);
  pipelineFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'], resources: ['*'] }));
  pipelineFn.addToRolePolicy(new iam.PolicyStatement({
    actions: ['ssm:GetParameters', 'ssm:GetParameter'],
    resources: [`arn:aws:ssm:${cdk.Stack.of(blocksStack).region}:${account}:parameter/video-explainer/*`],
  }));
  // Remotion Lambda client permissions (render, stills, progress)
  pipelineFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['lambda:InvokeFunction', 'lambda:GetFunction'], resources: [`arn:aws:lambda:*:${account}:function:remotion-render-*`] }));
  pipelineFn.addToRolePolicy(new iam.PolicyStatement({
    actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:GetBucketLocation', 's3:DeleteObject'],
    resources: ['arn:aws:s3:::remotionlambda-*', 'arn:aws:s3:::remotionlambda-*/*'],
  }));
  pipelineFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:ListAllMyBuckets'], resources: ['*'] }));
  pipelineFn.addToRolePolicy(new iam.PolicyStatement({
    actions: ['secretsmanager:GetSecretValue'],
    resources: [`arn:aws:secretsmanager:${cdk.Stack.of(blocksStack).region}:${account}:secret:video-explainer/progress-token-*`],
  }));

  // Role assumed by Remotion's render functions (name is fixed by Remotion), plus write access to our bucket.
  const remotionRole = new iam.Role(blocksStack, 'RemotionLambdaRole', {
    roleName: 'remotion-lambda-role',
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });
  remotionRole.addToPolicy(new iam.PolicyStatement({ actions: ['s3:ListAllMyBuckets'], resources: ['*'] }));
  remotionRole.addToPolicy(new iam.PolicyStatement({
    actions: ['s3:CreateBucket', 's3:ListBucket', 's3:PutBucketAcl', 's3:GetObject', 's3:DeleteObject', 's3:PutObjectAcl', 's3:PutObject', 's3:GetBucketLocation'],
    resources: ['arn:aws:s3:::remotionlambda-*', 'arn:aws:s3:::remotionlambda-*/*'],
  }));
  remotionRole.addToPolicy(new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: ['arn:aws:lambda:*:*:function:remotion-render-*'] }));
  remotionRole.addToPolicy(new iam.PolicyStatement({ actions: ['logs:CreateLogGroup'], resources: ['arn:aws:logs:*:*:log-group:/aws/lambda-insights'] }));
  remotionRole.addToPolicy(new iam.PolicyStatement({
    actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
    resources: ['arn:aws:logs:*:*:log-group:/aws/lambda/remotion-render-*', 'arn:aws:logs:*:*:log-group:/aws/lambda-insights:*'],
  }));
  bucket.grantReadWrite(remotionRole);

  // Blocks backend: start executions + read status/video
  blocksStack.executionRole.addToPrincipalPolicy(new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    // Name-based ARN (not a resource reference): the pipeline's env references the API URL, so a direct
    // reference here would create a CloudFormation dependency cycle.
    resources: [`arn:aws:lambda:${cdk.Stack.of(blocksStack).region}:${account}:function:${stackName}-explainer`, `arn:aws:lambda:${cdk.Stack.of(blocksStack).region}:${account}:function:${stackName}-explainer:*`],
  }));
  // Cancel + self-healing sweep: look up and stop durable executions of the pipeline (and nothing else).
  blocksStack.executionRole.addToPrincipalPolicy(new iam.PolicyStatement({
    actions: ['lambda:ListDurableExecutionsByFunction', 'lambda:GetDurableExecution', 'lambda:StopDurableExecution', 'lambda:SendDurableExecutionCallbackSuccess'],
    resources: [
      `arn:aws:lambda:${cdk.Stack.of(blocksStack).region}:${account}:function:${stackName}-explainer`,
      `arn:aws:lambda:${cdk.Stack.of(blocksStack).region}:${account}:function:${stackName}-explainer:*`,
    ],
  }));
  blocksStack.executionRole.addToPrincipalPolicy(new iam.PolicyStatement({
    actions: ['ssm:GetParameters', 'ssm:GetParameter'],
    resources: ['voices', 'elevenlabs-voice-id', 'max-concurrent', 'daily-limit'].map((n) => `arn:aws:ssm:${cdk.Stack.of(blocksStack).region}:${account}:parameter/video-explainer/${n}`),
  }));
  blocksStack.executionRole.addToPrincipalPolicy(new iam.PolicyStatement({
    actions: ['s3:GetObject', 's3:ListBucket'],
    resources: [bucket.bucketArn, bucket.arnForObjects('explainer/*')],
  }));
  // Deleting a video removes its folder. The shared caches (explainer/tts-cache/) are never targeted by the code.
  blocksStack.executionRole.addToPrincipalPolicy(new iam.PolicyStatement({
    actions: ['s3:DeleteObject'],
    resources: [bucket.arnForObjects('explainer/*')],
  }));
  // Short-lived presigned uploads of the user's narration takes, and nothing else.
  blocksStack.executionRole.addToPrincipalPolicy(new iam.PolicyStatement({
    actions: ['s3:PutObject'],
    resources: [bucket.arnForObjects('explainer/*/narration/*')],
  }));
  // Script editor: saves the edited script (with a backup next to it) and refreshes the recording page's request.
  blocksStack.executionRole.addToPrincipalPolicy(new iam.PolicyStatement({
    actions: ['s3:PutObject'],
    resources: [bucket.arnForObjects('explainer/*/spec.*'), bucket.arnForObjects('explainer/*/narration-request.json')],
  }));

  // Sign-in (the AuthCognito block has no option for these yet). Email codes need SES, and SES needs a sending
  // authorization policy on the identity for email.cognito-idp.amazonaws.com. Open sign-up is off: this is the only account.
  const userPool = blocksStack.node.findAll().find((c): c is cognito.CfnUserPool =>
    cdk.CfnResource.isCfnResource(c) && c.cfnResourceType === 'AWS::Cognito::UserPool');
  if (!userPool) throw new Error('Sign-in user pool not found');
  userPool.addPropertyOverride('EmailConfiguration', {
    EmailSendingAccount: 'DEVELOPER',
    From: 'Durable Studio <support@educloud.academy>',
    SourceArn: `arn:aws:ses:${cdk.Stack.of(blocksStack).region}:${account}:identity/support@educloud.academy`,
  });
  // The studio's sign-in account. Kept in .env (STUDIO_OWNER_EMAIL) so it isn't in the repo; deploying without it would delete the account.
  const ownerEmail = process.env.STUDIO_OWNER_EMAIL;
  if (!ownerEmail) throw new Error('Set STUDIO_OWNER_EMAIL in .env before deploying');
  new cognito.CfnUserPoolUser(blocksStack, 'StudioOwner', {
    userPoolId: userPool.ref,
    username: ownerEmail,
    messageAction: 'SUPPRESS',
    userAttributes: [{ name: 'email', value: ownerEmail }, { name: 'email_verified', value: 'true' }],
  });

  new cdk.CfnOutput(blocksStack, 'ExplainerBucketName', { value: bucket.bucketName });
  new cdk.CfnOutput(blocksStack, 'ExplainerPipelineAlias', { value: pipelineAlias.functionArn });
}

// Add static site hosting when deploying
if (!sandboxMode) {
  new Hosting(blocksStack, 'Hosting', {
    root: join(__dirname, '..'),
    buildCommand: 'npm run build',
    buildOutputDir: 'dist',
    api: blocksStack,
    domain: { domainName: 'studio.educloud.academy', hostedZone: 'educloud.academy', hostedZoneId: 'Z08369192HQK5TJ7EQDJJ' },
  });
}
