import { HandleValue } from './index';

export type RouteApiError = {
  name: string;
  code: string;
  message: string;
  link?: string; // link to error message details
  action?: string; // label for error link
  errors?: string[]; // array of all error messages
};

export type HasField = Array<
  | {
      type: 'host';
      value: string;
    }
  | {
      type: 'header' | 'cookie' | 'query';
      key: string;
      value?: string;
    }
>;

export type Source = {
  src: string;
  dest?: string;
  headers?: { [name: string]: string };
  methods?: string[];
  continue?: boolean;
  override?: boolean;
  check?: boolean;
  important?: boolean;
  status?: number;
  has?: HasField;
  locale?: {
    redirect?: Record<string, string>;
    cookie?: string;
  };
};

export type Handler = {
  handle: HandleValue;
  src?: string;
  dest?: string;
  status?: number;
};

export type Route = Source | Handler;

export type NormalizedRoutes = {
  routes: Route[] | null;
  error: RouteApiError | null;
};

export interface GetRoutesProps {
  nowConfig: VercelConfig;
}

export interface MergeRoutesProps {
  userRoutes?: Route[] | null | undefined;
  builds: Build[];
}

export interface Build {
  use: string;
  entrypoint: string;
  routes?: Route[];
}

export interface VercelConfig {
  name?: string;
  version?: number;
  routes?: Route[];
  cleanUrls?: boolean;
  rewrites?: Rewrite[];
  redirects?: Redirect[];
  headers?: Header[];
  trailingSlash?: boolean;
}

export interface Rewrite {
  source: string;
  destination: string;
  has?: HasField;
}

export interface Redirect {
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
  has?: HasField;
}

export interface Header {
  source: string;
  headers: HeaderKeyValue[];
  has?: HasField;
}

export interface HeaderKeyValue {
  key: string;
  value: string;
}

export interface AppendRoutesToPhaseProps {
  /**
   * All input routes including `handle` phases.
   */
  routes: Route[] | null;
  /**
   * The routes to append to a specific phase.
   */
  newRoutes: Route[] | null;
  /**
   * The phase to append the routes such as `filesystem`.
   */
  phase: HandleValue;
}

/** @deprecated Use VercelConfig instead. */
export type NowConfig = VercelConfig;

/** @deprecated Use Rewrite instead. */
export type NowRewrite = Rewrite;

/** @deprecated Use Redirect instead. */
export type NowRedirect = Redirect;

/** @deprecated Use Header instead. */
export type NowHeader = Header;

/** @deprecated Use HeaderKeyValue instead. */
export type NowHeaderKeyValue = HeaderKeyValue;
