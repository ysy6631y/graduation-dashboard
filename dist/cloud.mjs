import { migrateState, persistRemote } from "./core.mjs";
import { createClient } from "@supabase/supabase-js";

const TABLE = "workspace_state";

export async function connectCloud(url, anonKey) {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
}

export async function requestMagicLink(client, email) {
  return client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: window.location.href.split("#")[0] },
  });
}

export async function activeSession(client) {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function workspaceAdapter(client) {
  async function read() {
    const { data, error } = await client
      .from(TABLE)
      .select("payload, revision")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      state: { ...migrateState(data.payload), revision: data.revision },
      revision: data.revision,
    };
  }

  return {
    async read() {
      const value = await read();
      if (!value) throw new Error("공유 작업공간을 불러오지 못했습니다.");
      return value;
    },
    async loadOrSeed(localState) {
      let value = await read();
      if (!value) {
        const { error } = await client.from(TABLE).insert({
          id: 1,
          payload: localState,
          revision: 0,
        });
        // A different team member may seed at the same time. In that case the
        // unique key winner is authoritative and is loaded below.
        if (error && error.code !== "23505") throw error;
        value = await read();
      }
      if (!value) throw new Error("공유 작업공간을 초기화하지 못했습니다.");
      return value;
    },
    async compareAndSwap(expectedRevision, payload) {
      const { data, error } = await client.rpc("save_workspace_state", {
        expected_revision: expectedRevision,
        next_payload: payload,
      });
      if (error) throw error;
      return data === true;
    },
    async save(before, proposed, options) {
      return persistRemote(this, before, proposed, options);
    },
    subscribe(onChange, onStatus = () => {}) {
      const channel = client
        .channel("graduation-workspace-state")
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: TABLE,
            filter: "id=eq.1",
          },
          async () => {
            try {
              const latest = await read();
              if (latest) onChange(latest.state);
            } catch (error) {
              onStatus(error.message || "실시간 동기화를 확인해주세요.");
            }
          },
        )
        .subscribe((status) => onStatus(status));
      return () => client.removeChannel(channel);
    },
  };
}
