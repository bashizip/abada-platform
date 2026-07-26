import React, {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

type Location = {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
};

type NavigateOptions = {
  replace?: boolean;
  state?: unknown;
};

type Navigate = (to: string, options?: NavigateOptions) => void;

type RouterContextValue = {
  location: Location;
  navigate: Navigate;
};

const RouterContext = createContext<RouterContextValue | null>(null);
const ParamsContext = createContext<Record<string, string>>({});

const currentLocation = (): Location => ({
  pathname: window.location.pathname,
  search: window.location.search,
  hash: window.location.hash,
  state: window.history.state?.abadaState ?? null,
});

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(currentLocation);

  useEffect(() => {
    const handlePopState = () => setLocation(currentLocation());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback<Navigate>((to, options = {}) => {
    const target = new URL(to, window.location.href);
    if (target.origin !== window.location.origin) {
      window.location.assign(target.href);
      return;
    }

    const state = { abadaState: options.state ?? null };
    if (options.replace) {
      window.history.replaceState(state, "", target.href);
    } else {
      window.history.pushState(state, "", target.href);
    }
    setLocation(currentLocation());
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
}

export { BrowserRouter as Router };

export function useLocation(): Location {
  return useRouter().location;
}

export function useNavigate(): Navigate {
  return useRouter().navigate;
}

export function useParams<
  T extends Record<string, string | undefined> = Record<string, string>,
>(): T {
  return useContext(ParamsContext) as T;
}

type RouteProps = {
  path: string;
  element: ReactElement;
};

export function Route(_props: RouteProps) {
  return null;
}

export function Routes({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const routes = React.Children.toArray(children).filter(
    (child): child is ReactElement<RouteProps> =>
      isValidElement<RouteProps>(child) && child.type === Route,
  );

  for (const route of routes) {
    const params = matchPath(route.props.path, pathname);
    if (params) {
      return (
        <ParamsContext.Provider value={params}>
          {route.props.element}
        </ParamsContext.Provider>
      );
    }
  }

  return null;
}

export function Navigate({
  to,
  replace = false,
  state,
}: {
  to: string;
  replace?: boolean;
  state?: unknown;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(to, { replace, state });
  }, [navigate, replace, state, to]);

  return null;
}

type NavLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "className" | "href"
> & {
  to: string;
  className?: string | ((state: { isActive: boolean }) => string);
};

export function NavLink({
  to,
  className,
  onClick,
  children,
  ...props
}: NavLinkProps) {
  const { location, navigate } = useRouter();
  const target = new URL(to, window.location.href);
  const isActive =
    target.pathname === "/"
      ? location.pathname === "/"
      : location.pathname === target.pathname ||
        location.pathname.startsWith(`${target.pathname}/`);
  const resolvedClassName =
    typeof className === "function" ? className({ isActive }) : className;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.target === "_blank"
    ) {
      return;
    }
    event.preventDefault();
    navigate(`${target.pathname}${target.search}${target.hash}`);
  };

  return (
    <a
      {...props}
      href={`${target.pathname}${target.search}${target.hash}`}
      className={resolvedClassName}
      onClick={handleClick}
      aria-current={isActive ? "page" : undefined}
    >
      {children}
    </a>
  );
}

function useRouter(): RouterContextValue {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error("Router hooks must be used inside BrowserRouter");
  }
  return context;
}

function matchPath(
  routePath: string,
  pathname: string,
): Record<string, string> | null {
  if (routePath === "*") return {};

  const routeParts = splitPath(routePath);
  const pathParts = splitPath(pathname);
  if (routeParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < routeParts.length; index += 1) {
    const routePart = routeParts[index];
    const pathPart = pathParts[index];
    if (routePart.startsWith(":")) {
      params[routePart.slice(1)] = decodeURIComponent(pathPart);
    } else if (routePart !== pathPart) {
      return null;
    }
  }
  return params;
}

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}
