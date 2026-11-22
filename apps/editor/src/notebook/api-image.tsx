import {
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";

type ApiImageProps = ImgHTMLAttributes<HTMLImageElement> & { src: string };

type ImageState =
  | { src: string; kind: "loading" }
  | { src: string; kind: "ready"; objectUrl: string }
  | { src: string; kind: "failed" };

/**
 * An API image in the notebook build. An <img src> cannot carry the
 * session's header, so the image is fetched through the page's (scoped)
 * fetch and shown from an object URL. Nothing is rendered while it loads or
 * after it fails; a failure calls onError as the <img> it replaces would.
 */
export function ApiImage({ src, onError, ...props }: ApiImageProps) {
  const [state, setState] = useState<ImageState>({ src, kind: "loading" });
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    let current = true;
    let objectUrl: string | null = null;
    // A src seen before must not show the object URL revoked when it changed.
    setState({ src, kind: "loading" });
    const fail = () => {
      setState({ src, kind: "failed" });
      onErrorRef.current?.(failureEvent());
    };
    fetch(src)
      .then(async (response) => {
        if (!current) return;
        if (!response.ok) return fail();
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        // A result for a src that has changed, or after unmount, is discarded.
        if (!current) return URL.revokeObjectURL(url);
        objectUrl = url;
        setState({ src, kind: "ready", objectUrl: url });
      })
      .catch(() => {
        if (current) fail();
      });
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  if (state.src !== src || state.kind !== "ready") return null;
  return <img {...props} src={state.objectUrl} />;
}

/** The existing callers only note that the image failed. */
function failureEvent(): SyntheticEvent<HTMLImageElement, Event> {
  const event = new Event("error");
  return {
    nativeEvent: event,
    currentTarget: null,
    target: null,
    bubbles: false,
    cancelable: false,
    defaultPrevented: false,
    eventPhase: 0,
    isTrusted: false,
    timeStamp: event.timeStamp,
    type: "error",
    isDefaultPrevented: () => false,
    isPropagationStopped: () => false,
    persist: () => {},
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as SyntheticEvent<HTMLImageElement, Event>;
}
