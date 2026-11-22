import {
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type ReactElement,
  type SyntheticEvent,
} from "react";

type ApiImageProps = ImgHTMLAttributes<HTMLImageElement> & { src: string };

type ImageState =
  | { src: string; kind: "loading" }
  | { src: string; kind: "ready"; objectUrl: string }
  | { src: string; kind: "failed" };

/** How far outside the viewport a lazy image starts loading. */
const LAZY_ROOT_MARGIN = "100% 0px";

/**
 * An API image in the notebook build. An <img src> cannot carry the
 * session's header, so the image is fetched through the page's (scoped)
 * fetch and shown from an object URL. While it loads, and after it fails,
 * a placeholder <img> without a source takes its place, with the same
 * attributes, so the page's CSS sizes it as it sizes the image. A failure
 * (of the fetch, or of the browser showing what was fetched) calls onError
 * as the <img> it replaces would. With loading="lazy" the
 * fetch waits until the placeholder is near the viewport, as the browser
 * would wait for an <img loading="lazy">.
 */
// The callers' lazy loaders fall back to a component that renders nothing,
// so this one is typed as a component that may.
export function ApiImage({
  src,
  onError,
  loading,
  ...props
}: ApiImageProps): ReactElement | null {
  const [state, setState] = useState<ImageState>({ src, kind: "loading" });
  const placeholder = useRef<HTMLImageElement>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const lazy = loading === "lazy";
  useEffect(() => {
    let current = true;
    let objectUrl: string | null = null;
    let observer: IntersectionObserver | null = null;
    const stopObserving = () => {
      observer?.disconnect();
      observer = null;
    };
    // A src seen before must not show the object URL revoked when it changed.
    setState({ src, kind: "loading" });
    const fail = () => {
      setState({ src, kind: "failed" });
      onErrorRef.current?.(failureEvent());
    };
    const load = () => {
      stopObserving();
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
    };
    const element = placeholder.current;
    if (lazy && element && typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(
        (entries) => {
          // Not after the fetch started (the observer is then disconnected).
          if (!current || !observer) return;
          if (entries.some((entry) => entry.isIntersecting)) load();
        },
        { root: scrollContainer(element), rootMargin: LAZY_ROOT_MARGIN },
      );
      observer.observe(element);
    } else load();
    return () => {
      current = false;
      stopObserving();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, lazy]);
  if (state.src !== src || state.kind !== "ready")
    return <img ref={placeholder} {...props} alt="" aria-hidden="true" />;
  return (
    <img
      {...props}
      loading={loading}
      src={state.objectUrl}
      onError={(event) => {
        // Fetched, but not something the browser can show as an image.
        setState({ src, kind: "failed" });
        onError?.(event);
      }}
    />
  );
}

/**
 * The nearest ancestor that scrolls its content, or null for the page. A
 * margin around the viewport does not reach into such a container: its own
 * box clips what counts as visible, so the margin has to be around it.
 */
function scrollContainer(element: Element): Element | null {
  const view = element.ownerDocument.defaultView;
  for (
    let parent = element.parentElement;
    parent && view;
    parent = parent.parentElement
  )
    if (
      /^(?:auto|scroll|overlay)$/u.test(view.getComputedStyle(parent).overflowY)
    )
      return parent;
  return null;
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
