declare module "react" {
  export function createElement(...args: any[]): any;
  export function useEffect(effect: () => void | (() => void), dependencies: unknown[]): void;
  export function useState<T>(initial: T): [T, (value: T) => void];
}
