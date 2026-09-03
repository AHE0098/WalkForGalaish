import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * A generic stack of full-screen views. Anything that needs to take over the
 * screen — a card reader, the deck browser, the status sheet, the menu — is
 * pushed here rather than being wired into the board. Backdrop click, Escape
 * and the back button all pop one level.
 */
export interface ViewEntry { id: string; title?: string; node: React.ReactNode; wide?: boolean; }

interface ViewApi {
  push(v: ViewEntry): void;
  pop(): void;
  replace(v: ViewEntry): void;
  closeAll(): void;
  top: ViewEntry | null;
  depth: number;
}

const Ctx = createContext<ViewApi | null>(null);
export const useViews = (): ViewApi => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useViews must be used inside <ViewProvider>');
  return v;
};

export function ViewProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<ViewEntry[]>([]);

  const api = useMemo<ViewApi>(() => ({
    push: v => setStack(s => [...s, v]),
    pop: () => setStack(s => s.slice(0, -1)),
    replace: v => setStack(s => [...s.slice(0, -1), v]),
    closeAll: () => setStack([]),
    top: stack[stack.length - 1] ?? null,
    depth: stack.length,
  }), [stack]);

  React.useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') api.pop(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [api]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {stack.map((v, i) => (
        <div key={v.id + i} className="viewlayer" style={{ zIndex: 50 + i }}
             onClick={() => api.pop()} role="dialog" aria-label={v.title ?? v.id}>
          <div className={`viewlayer__body${v.wide ? ' viewlayer__body--wide' : ''}`}
               onClick={e => e.stopPropagation()}>
            {v.title && (
              <header className="viewlayer__bar">
                <button className="ghost" onClick={() => api.pop()}>‹ Back</button>
                <b>{v.title}</b>
                <button className="ghost" onClick={() => api.closeAll()}>Close</button>
              </header>
            )}
            {v.node}
          </div>
        </div>
      ))}
    </Ctx.Provider>
  );
}
