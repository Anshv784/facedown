import { CONTRACT, RPC } from "./config";
import type { LeaderEntry, DealerConfig, HandRecord, Options, PlayerRecord, Table, TableSummary } from "./types";

let id = 0;
export async function view<T>(method: string, args: object = {}): Promise<T> {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
    const { mockView } = await import("./mock");
    return mockView(method, args as Record<string, unknown>) as T;
  }
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: CONTRACT,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.cause?.info?.error_message ?? json.error.message ?? "RPC error");
  if (json.result?.error) throw new Error(json.result.error);
  const bytes = new Uint8Array(json.result.result as number[]);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export const chain = {
  tables: () => view<TableSummary[]>("list_tables"),
  table: (id: number) => view<Table | null>("get_table", { id }),
  options: (table: number) => view<[number, Options] | null>("options", { table }),
  player: (id: string) => view<PlayerRecord | null>("get_player", { id }),
  hand: (table: number, hand: string) => view<HandRecord | null>("get_hand", { table, hand }),
  recent: (table: number, count = 12) => view<HandRecord[]>("recent_hands", { table, count }),
  dealer: () => view<DealerConfig>("dealer_config"),
  leaderboard: () => view<LeaderEntry[]>("leaderboard"),
  stats: () => view<{ tables: number; hands_played: string }>("stats"),
};
