declare module "react" {
  export function createElement(...args: any[]): any;
  export function useEffect(effect: () => void | (() => void), dependencies: unknown[]): void;
  export function useState<T>(initial: T): [T, (value: T | ((current: T) => T)) => void];
  export function useRef<T>(initial: T): { current: T };
}
