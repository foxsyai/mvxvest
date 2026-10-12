import {
  DependencyList,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';

export interface AsyncState<T> {
  data?: T;
  error?: unknown;
  loading: boolean;
  /** Runs it again (after a transaction, or when the reader asks). */
  reload: () => void;
}

/**
 * Runs `work` whenever `deps` change, and again when a transaction this app
 * sent has settled (the `mvxvest:settled` event), so pages show what the
 * chain holds without a manual refresh. An answer that arrives after a newer
 * request started is dropped. A reload keeps the last answer on screen; new
 * `deps` do not (the answer for other inputs is not shown for these).
 */
export const useAsync = <T>(
  work: () => Promise<T>,
  deps: DependencyList
): AsyncState<T> => {
  const [state, setState] = useState<{
    data?: T;
    error?: unknown;
    loading: boolean;
    /** The deps the data and error belong to. */
    for?: DependencyList;
  }>({ loading: true });
  const run = useRef(0);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    const onSettled = () => setTick((value) => value + 1);
    window.addEventListener('mvxvest:settled', onSettled);
    return () => window.removeEventListener('mvxvest:settled', onSettled);
  }, []);

  useEffect(() => {
    const id = ++run.current;
    const asked = deps;
    setState((previous) =>
      previous.for && same(previous.for, asked)
        ? { ...previous, loading: true }
        : { loading: true, for: asked }
    );
    work().then(
      (data) =>
        id === run.current && setState({ data, loading: false, for: asked }),
      (error) =>
        id === run.current &&
        setState((previous) => ({
          data:
            previous.for && same(previous.for, asked)
              ? previous.data
              : undefined,
          error,
          loading: false,
          for: asked
        }))
    );
  }, [...deps, tick]);

  // Between new deps and the effect that reads for them, nothing stale shows.
  if (!state.for || !same(state.for, deps)) return { loading: true, reload };
  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    reload
  };
};

const same = (a: DependencyList, b: DependencyList) =>
  a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
