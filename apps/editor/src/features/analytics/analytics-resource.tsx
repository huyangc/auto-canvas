import { useEffect, useState, type ReactNode } from "react";

/** A changed query immediately hides old results, including late responses. */
export function Resource<T>({
  load,
  children,
  revision,
}: {
  load: () => Promise<T>;
  children: (data: T) => ReactNode;
  revision: number;
}) {
  const [result, setResult] = useState<
    | { load: typeof load; revision: number; value: T }
    | { load: typeof load; revision: number; error: string }
  >();
  useEffect(() => {
    let current = true;
    load().then(
      (value) => {
        if (current) setResult({ load, revision, value });
      },
      (reason) => {
        if (current) setResult({ load, revision, error: String(reason) });
      },
    );
    return () => {
      current = false;
    };
  }, [load, revision]);
  if (result?.load !== load || result.revision !== revision)
    return <p role="status">Loading…</p>;
  if ("error" in result) return <p role="alert">{result.error}</p>;
  return children(result.value);
}
