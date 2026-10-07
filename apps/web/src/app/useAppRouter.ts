import { useCallback, useEffect, useState } from "react";
import type { AppRouteId, AppRouteState } from "./routing.js";
import { appPath, parseAppRoute } from "./routing.js";

export function useAppRouter(allowedRoutes: readonly AppRouteId[]): {
  route: AppRouteState;
  navigate: (route: AppRouteState) => void;
} {
  const [route, setRoute] = useState<AppRouteState>(() => parseAppRoute(allowedRoutes));

  const navigate = useCallback((nextRoute: AppRouteState): void => {
    const path = appPath(nextRoute);
    if (`${window.location.pathname}${window.location.search}` !== path) {
      window.history.pushState(null, "", path);
    }
    setRoute(nextRoute);
  }, []);

  useEffect(() => {
    const applyLocation = (): void => setRoute(parseAppRoute(allowedRoutes));
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, [allowedRoutes]);

  return { route, navigate };
}
