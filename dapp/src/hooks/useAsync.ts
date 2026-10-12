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
 * request started is dropped.
 */
export const useAsync = <T>(
  work: () => Promise<T>,
  deps: DependencyList
): AsyncState<T> => {
  const [state, setState] = useState<{
    data?: T;
    error?: unknown;
    loading: boolean;
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
    setState((previous) => ({ ...previous, loading: true }));
    work().then(
      (data) => id === run.current && setState({ data, loading: false }),
      (error) =>
        id === run.current &&
        setState((previous) => ({ data: previous.data, error, loading: false }))
    );
  }, [...deps, tick]);

  return { ...state, reload };
};
