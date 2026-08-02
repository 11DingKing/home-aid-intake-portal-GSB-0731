"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface AnnouncerApi {
  announce: (message: string) => void;
}

const AnnouncerContext = createContext<AnnouncerApi>({ announce: () => {} });

export function useAnnouncer(): AnnouncerApi {
  return useContext(AnnouncerContext);
}

/**
 * 屏幕阅读器公告区（aria-live polite）。相同文本连续公告时通过先清空再写入
 * 保证读屏器重复播报。
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage("");
    timer.current = setTimeout(() => setMessage(msg), 40);
  }, []);

  return (
    <AnnouncerContext.Provider value={{ announce }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="sr-announcer"
      >
        {message}
      </div>
    </AnnouncerContext.Provider>
  );
}
