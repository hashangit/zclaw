/**
 * Type declarations for React — used by src/sdk/react.ts
 *
 * React is an optional peer dependency. This declaration allows the SDK
 * to compile without React installed, while consumers get full type safety
 * when React is present in their project.
 */
declare module "react" {
  // Hook types needed by useChat
  export function useState<S>(
    initialState: S | (() => S),
  ): [S, (value: S | ((prev: S) => S)) => void];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function useCallback<T extends (...args: any[]) => any>(
    callback: T,
    deps: readonly unknown[],
  ): T;

  export function useRef<T>(initialValue: T): { current: T };

  export type FormEvent = Event & {
    preventDefault: () => void;
  };
}
