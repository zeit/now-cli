import { NowConfig } from './util/dev/types';
import { Output } from './util/output';

export type ThenArg<T> = T extends Promise<infer U> ? U : T;

export interface NowContext {
  argv: string[];
  apiUrl: string;
  authConfig: {
    token: string;
  };
  output: Output;
  config: {
    currentTeam: string;
    updateChannel: string;
  };
  localConfig: NowConfig;
}

type Billing = {
  addons: string[];
  cancelation?: number;
  period: { start: number; end: number };
  plan: string;
  platform: string;
  trial: { start: number; end: number };
};

export type User = {
  uid: string;
  avatar: string;
  bio?: string;
  date: number;
  email: string;
  username: string;
  website?: string;
  billingChecked: boolean;
  billing: Billing;
  github?: {
    email: string;
    installation: {
      id: string;
      login: string;
      loginType: string;
    };
    login: string;
    updatedAt: number;
  };
  name?: string;
};

export type Team = {
  id: string;
  avatar?: string;
  billing: Billing;
  created: string;
  creatorId: string;
  membership: { uid: string; role: 'MEMBER' | 'OWNER'; created: number };
  name: string;
  slug: string;
};

export type Domain = {
  id: string;
  name: string;
  boughtAt: number;
  createdAt: number;
  expiresAt: number;
  transferStartedAt?: number;
  transferredAt?: number | null;
  orderedAt?: number;
  serviceType: 'zeit.world' | 'external' | 'na';
  verified: boolean;
  nsVerifiedAt: number | null;
  txtVerifiedAt: number | null;
  verificationRecord: string;
  nameservers: string[];
  intendedNameservers: string[];
  creator: {
    id: string;
    username: string;
    email: string;
  };
};

export type DomainConfig = {
  configuredBy: null | 'CNAME' | 'A' | 'http';
  misconfigured: boolean;
  serviceType: 'zeit.world' | 'external' | 'na';
  nameservers: string[];
  cnames: string[] & { traceString?: string };
  aValues: string[] & { traceString?: string };
  dnssecEnabled?: boolean;
};

export type Cert = {
  uid: string;
  autoRenew: boolean;
  cns: string[];
  created: string;
  creator: string;
  expiration: string;
};

export type Deployment = {
  uid: string;
  url: string;
  name: string;
  type: 'LAMBDAS';
  state:
    | 'BUILDING'
    | 'ERROR'
    | 'INITIALIZING'
    | 'QUEUED'
    | 'READY'
    | 'CANCELED';
  version?: number;
  created: number;
  creator: { uid: string };
  target: string | null;
  ownerId: string;
  projectId: string;
  meta: {
    [key: string]: any;
  };
};

export type Alias = {
  uid: string;
  alias: string;
  created: string;
  deployment: {
    id: string;
    url: string;
  };
  creator: {
    uid: string;
    username: string;
    email: string;
  };
  deploymentId?: string;
};

export type DNSRecord = {
  id: string;
  creator: string;
  mxPriority?: number;
  name: string;
  priority?: number;
  slug: string;
  type: string;
  value: string;
  created: number;
  updated: number;
  createdAt: number;
  updatedAt: number;
  domain: string;
};

type SRVRecordData = {
  name: string;
  type: 'SRV';
  srv: {
    port: number;
    priority: number;
    target: string;
    weight: number;
  };
};

type MXRecordData = {
  name: string;
  type: 'MX';
  value: string;
  mxPriority: number;
};

export type DNSRecordData =
  | {
      name: string;
      type: string;
      value: string;
    }
  | SRVRecordData
  | MXRecordData;

export interface ProjectAliasTarget {
  createdAt?: number;
  domain: string;
  redirect?: string | null;
  target: 'PRODUCTION' | 'STAGING';
  configuredBy?: null | 'CNAME' | 'A';
  configuredChangedAt?: null | number;
  configuredChangeAttempts?: [number, number];
}

export interface Secret {
  uid: string;
  name: string;
  value: string;
  teamId?: string;
  userId?: string;
  projectId?: string;
  created: string;
  createdAt: number;
}

export enum ProjectEnvTarget {
  Production = 'production',
  Preview = 'preview',
  Development = 'development',
}

export enum ProjectEnvType {
  Plaintext = 'plain',
  Secret = 'secret',
  System = 'system',
}

export interface ProjectEnvVariable {
  key: string;
  value: string;
  type: ProjectEnvType;
  configurationId?: string | null;
  createdAt?: number;
  updatedAt?: number;
  target?: ProjectEnvTarget | ProjectEnvTarget[];
}

export interface ProjectEnvVariableV5 extends ProjectEnvVariable {
  target?: ProjectEnvTarget;
  system?: boolean;
}

export interface ProjectSettings {
  framework?: string | null;
  devCommand?: string | null;
  buildCommand?: string | null;
  outputDirectory?: string | null;
  rootDirectory?: string | null;
  autoExposeSystemEnvs?: boolean;
  directoryListing?: boolean;
}

export interface Project extends ProjectSettings {
  id: string;
  name: string;
  accountId: string;
  updatedAt: number;
  createdAt: number;
  alias?: ProjectAliasTarget[];
  devCommand?: string | null;
  framework?: string | null;
  rootDirectory?: string | null;
  latestDeployments?: Partial<Deployment>[];
  autoExposeSystemEnvs?: boolean;
}

export interface Org {
  type: 'user' | 'team';
  id: string;
  slug: string;
}

export interface ProjectLink {
  projectId: string;
  orgId: string;
}

export interface PaginationOptions {
  prev: number;
  count: number;
  next?: number;
}

export type ProjectLinkResult =
  | { status: 'linked'; org: Org; project: Project }
  | { status: 'not_linked'; org: null; project: null }
  | { status: 'error'; exitCode: number };
