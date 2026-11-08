import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { chain } from "./near";
import { createIdentity, loadIdentity, playerId, saveIdentity, xpubOf, type Identity } from "./identity";
import { send } from "./relay";
import type { Command, PlayerRecord } from "./types";

type PlayerState = {
  identity: Identity | null;
  id: string | null;
  record: PlayerRecord | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  register: (name: string) => Promise<boolean>;
  run: (command: Command) => Promise<boolean>;
  adopt: (identity: Identity) => void;
  refresh: () => void;
};

const Ctx = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());
  const [record, setRecord] = useState<PlayerRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextNonce = useRef<number | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const id = identity ? playerId(identity) : null;

  const refresh = useCallback(async () => {
    if (!id) {
      setRecord(null);
      setLoading(false);
      return;
    }
    try {
      const r = await chain.player(id);
      setRecord(r);
      if (r && (nextNonce.current === null || r.nonce > nextNonce.current)) nextNonce.current = r.nonce;
    } catch {
      /* keep the last known record */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // Commands go out one at a time so nonces never race.
  const enqueue = useCallback(<T,>(job: () => Promise<T>) => {
    const p = queue.current.then(job, job);
    queue.current = p.catch(() => undefined);
    return p;
  }, []);

  const run = useCallback(
    (command: Command) =>
      enqueue(async () => {
        if (!identity) return false;
        setBusy(true);
        setError(null);
        try {
          if (nextNonce.current === null) {
            const r = await chain.player(playerId(identity));
            if (!r) throw new Error("make a player first");
            nextNonce.current = r.nonce;
          }
          await send(identity, nextNonce.current, command);
          nextNonce.current += 1;
          refresh();
          return true;
        } catch (e) {
          // Resync the nonce from chain after any failure.
          nextNonce.current = null;
          setError(e instanceof Error ? e.message : String(e));
          return false;
        } finally {
          setBusy(false);
        }
      }),
    [enqueue, identity, refresh],
  );

  const register = useCallback(
    (name: string) =>
      enqueue(async () => {
        const me = identity ?? createIdentity();
        if (!identity) setIdentity(me);
        setBusy(true);
        setError(null);
        try {
          await send(me, 0, { do: "register", name: name.trim(), xpub: xpubOf(me) });
          nextNonce.current = 0;
          // The record shows up once the block lands.
          for (let i = 0; i < 10; i++) {
            const r = await chain.player(playerId(me));
            if (r) {
              setRecord(r);
              nextNonce.current = r.nonce;
              break;
            }
            await new Promise((res) => setTimeout(res, 800));
          }
          return true;
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          return false;
        } finally {
          setBusy(false);
        }
      }),
    [enqueue, identity],
  );

  const adopt = useCallback((next: Identity) => {
    saveIdentity(next);
    nextNonce.current = null;
    setRecord(null);
    setIdentity(next);
  }, []);

  return (
    <Ctx.Provider
      value={{
        identity,
        id,
        record,
        loading,
        busy,
        error,
        clearError: () => setError(null),
        register,
        run,
        adopt,
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function usePlayer() {
  const v = useContext(Ctx);
  if (!v) throw new Error("PlayerProvider missing");
  return v;
}

/** Polls `load` every `ms` while mounted; keeps the last good value. */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const go = async () => {
      try {
        const v = await load();
        if (live) {
          setData(v);
          setError(null);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
      if (live) timer = setTimeout(go, document.hidden ? ms * 4 : ms);
    };
    go();
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}
