import { Route, MergeRoutesProps, Build } from './types';
import { isHandler, HandleValue } from './index';

interface BuilderToRoute {
  [use: string]: Route[];
}

interface BuilderRoutes {
  [entrypoint: string]: BuilderToRoute;
}

function getBuilderRoutesMapping(builds: Build[]) {
  const builderRoutes: BuilderRoutes = {};
  for (const { entrypoint, routes, use } of builds) {
    if (routes) {
      if (!builderRoutes[entrypoint]) {
        builderRoutes[entrypoint] = {};
      }
      builderRoutes[entrypoint][use] = routes;
    }
  }
  return builderRoutes;
}

function getCheckAndContinue(
  routes: Route[]
): { checks: Route[]; continues: Route[]; others: Route[] } {
  const checks: Route[] = [];
  const continues: Route[] = [];
  const others: Route[] = [];

  for (const route of routes) {
    if (isHandler(route)) {
      // Should never happen, only here to make TS happy
      throw new Error(
        `Unexpected route found in getCheckAndContinue(): ${JSON.stringify(
          route
        )}`
      );
    } else if (route.check) {
      checks.push(route);
    } else if (route.continue && !route.override) {
      continues.push(route);
    } else {
      others.push(route);
    }
  }
  return { checks, continues, others };
}

export function mergeRoutes({ userRoutes, builds }: MergeRoutesProps): Route[] {
  const userHandleMap = new Map<HandleValue | null, Route[]>();
  let userPrevHandle: HandleValue | null = null;
  (userRoutes || []).forEach(route => {
    if (isHandler(route)) {
      userPrevHandle = route.handle;
    } else {
      const routes = userHandleMap.get(userPrevHandle);
      if (!routes) {
        userHandleMap.set(userPrevHandle, [route]);
      } else {
        routes.push(route);
      }
    }
  });

  const builderHandleMap = new Map<HandleValue | null, Route[]>();
  const builderRoutes = getBuilderRoutesMapping(builds);
  const sortedPaths = Object.keys(builderRoutes).sort();
  sortedPaths.forEach(path => {
    const br = builderRoutes[path];
    const sortedBuilders = Object.keys(br).sort();
    sortedBuilders.forEach(use => {
      let builderPrevHandle: HandleValue | null = null;
      br[use].forEach(route => {
        if (isHandler(route)) {
          builderPrevHandle = route.handle;
        } else {
          const routes = builderHandleMap.get(builderPrevHandle);
          if (!routes) {
            builderHandleMap.set(builderPrevHandle, [route]);
          } else {
            routes.push(route);
          }
        }
      });
    });
  });

  const outputRoutes: Route[] = [];
  const uniqueHandleValues = new Set([
    null,
    ...userHandleMap.keys(),
    ...builderHandleMap.keys(),
  ]);
  for (const handle of uniqueHandleValues) {
    const userRoutes = userHandleMap.get(handle) || [];
    const builderRoutes = builderHandleMap.get(handle) || [];
    const builderSorted = getCheckAndContinue(builderRoutes);
    if (
      handle !== null &&
      (userRoutes.length > 0 || builderRoutes.length > 0)
    ) {
      outputRoutes.push({ handle });
    }
    outputRoutes.push(...builderSorted.continues);
    outputRoutes.push(...userRoutes);
    outputRoutes.push(...builderSorted.checks);
    outputRoutes.push(...builderSorted.others);
  }
  return outputRoutes;
}
