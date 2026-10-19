import { useEffect, useRef, useState } from "react";
import type { Instance } from "../../worker/types";
import { api, messageOf } from "@/api";
import {
  selectFirstInstance,
  instanceRow,
  type InstanceResponse,
  type Row,
} from "@/instance-selection";
import { runOperation, type OperationAction } from "@/operations";

export interface Activity {
  id: number;
  action: OperationAction;
  time: number;
  message: string;
  failed?: boolean;
  oldIp?: string;
  newIp?: string;
}
interface ConsoleState {
  checking: boolean;
  authenticated: boolean;
  loading: boolean;
  instance?: Row;
  error: string;
  notice: string;
  result: string;
  job?: { message: string };
  history: Activity[];
}
export function useConsole() {
  const [state, setState] = useState<ConsoleState>({
    checking: true,
    authenticated: false,
    loading: false,
    error: "",
    notice: "",
    result: "",
    history: [],
  });
  const current = useRef(state);
  const busy = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const sessionAbort = useRef(new AbortController());
  function patch(next: Partial<ConsoleState>) {
    if (!mounted.current) return;
    current.current = { ...current.current, ...next };
    setState(current.current);
  }
  function request<T>(path: string, body?: unknown): Promise<T> {
    const version = generation.current;
    return api<T>(
      path,
      body,
      () => {
        if (version !== generation.current || !mounted.current) return;
        generation.current++;
        sessionAbort.current.abort();
        patch({
          checking: false,
          authenticated: false,
          instance: undefined,
          history: [],
          result: "",
          error: "",
          job: undefined,
          loading: false,
          notice: "登录已过期，请重新登录",
        });
      },
      sessionAbort.current.signal,
    );
  }
  async function discover(): Promise<Row> {
    return selectFirstInstance(await request<InstanceResponse>("instances"));
  }
  async function load() {
    const version = generation.current;
    const row = current.current.instance;
    patch({ loading: true, error: "" });
    try {
      let latest: Row;
      if (row) {
        const query = new URLSearchParams({
          region: row.region,
          name: row.name,
        });
        try {
          latest = instanceRow(
            await request<Instance>(`instance?${query}`),
            row.region,
          );
        } catch (error) {
          if ((error as { status?: number })?.status !== 404) throw error;
          latest = await discover();
        }
      } else latest = await discover();
      if (version === generation.current && current.current.authenticated)
        patch({ instance: latest });
    } catch (error) {
      if (version === generation.current) patch({ error: messageOf(error) });
    } finally {
      if (version === generation.current) patch({ loading: false });
    }
  }
  async function refresh() {
    if (
      !current.current.authenticated ||
      !mounted.current ||
      busy.current ||
      current.current.loading
    )
      return;
    await load();
  }
  useEffect(() => {
    mounted.current = true;
    sessionAbort.current = new AbortController();
    const version = generation.current;
    void (async () => {
      try {
        const session = await request<{ authenticated: boolean }>("session");
        if (!mounted.current || version !== generation.current) return;
        patch({ authenticated: session.authenticated });
        if (session.authenticated) await load();
      } catch (error) {
        if (version === generation.current) patch({ notice: messageOf(error) });
      } finally {
        if (version === generation.current) patch({ checking: false });
      }
    })();
    const protect = (event: BeforeUnloadEvent) => {
      if (busy.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => {
      mounted.current = false;
      generation.current++;
      sessionAbort.current.abort();
      window.removeEventListener("beforeunload", protect);
    };
  }, []);
  // Continue observing transitional AWS states after a refresh or a new visit.
  useEffect(() => {
    if (
      !state.authenticated ||
      state.job ||
      !["pending", "stopping"].includes(state.instance?.state.name ?? "")
    )
      return;
    const timer = window.setTimeout(() => {
      void refresh();
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [state.authenticated, state.job, state.instance, state.loading]);
  async function login(password: string) {
    if (busy.current || current.current.loading) return;
    sessionAbort.current = new AbortController();
    patch({ loading: true, notice: "" });
    try {
      await request("login", { password });
      generation.current++;
      patch({ authenticated: true, notice: "", result: "", history: [] });
      await load();
    } catch (error) {
      patch({ notice: messageOf(error) });
    } finally {
      patch({ loading: false });
    }
  }
  async function logout() {
    if (busy.current || current.current.loading) return;
    patch({ loading: true, notice: "" });
    try {
      await request("logout", {});
      generation.current++;
      patch({
        authenticated: false,
        instance: undefined,
        history: [],
        error: "",
        result: "",
      });
    } catch (error) {
      patch({ notice: messageOf(error) });
    } finally {
      patch({ loading: false });
    }
  }
  async function operate(action: OperationAction) {
    const row = current.current.instance;
    if (
      busy.current ||
      current.current.loading ||
      !current.current.authenticated ||
      !row ||
      current.current.error
    )
      return;
    busy.current = true;
    const version = generation.current;
    patch({
      job: { message: "检查实例状态" },
      notice: "",
      result: "",
    });
    const query = new URLSearchParams({ region: row.region, name: row.name });
    function record(entry: Omit<Activity, "id" | "time" | "action">) {
      if (version !== generation.current || !current.current.authenticated)
        return;
      patch({
        history: [
          { ...entry, id: ++sequence.current, time: Date.now(), action },
          ...current.current.history,
        ].slice(0, 100),
      });
    }
    const execute = async () => {
      const result = await runOperation(action, {
        get: async () => {
          const latest = instanceRow(
            await request<Instance>(`instance?${query}`),
            row.region,
          );
          if (version === generation.current) patch({ instance: latest });
          return latest;
        },
        command: async (command, rotate) => {
          await request(`action?${query}`, { action: command, rotate });
        },
        signal: sessionAbort.current.signal,
        progress: (message) => {
          if (version === generation.current && current.current.job)
            patch({ job: { message } });
        },
        now: Date.now,
        sleep: (ms) =>
          new Promise((resolve, reject) => {
            const signal = sessionAbort.current.signal;
            if (signal.aborted) return reject(signal.reason);
            const abort = () => {
              clearTimeout(timer);
              reject(signal.reason);
            };
            const timer = setTimeout(() => {
              signal.removeEventListener("abort", abort);
              resolve();
            }, ms);
            signal.addEventListener("abort", abort, { once: true });
          }),
      });
      if (version !== generation.current || !mounted.current) return;
      if (result.newIp && result.newIp !== result.oldIp) {
        patch({ job: { message: "正在同步订阅配置" } });
        try {
          await request("sub", { ip: result.newIp });
        } catch (error) {
          if (version === generation.current)
            patch({ notice: `订阅同步未全部完成：${messageOf(error)}` });
        }
      }
      record(result);
      if (version === generation.current) patch({ result: result.message });
    };
    try {
      if (navigator.locks) {
        await navigator.locks.request(
          `lightsail:${row.region}:${row.name}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) throw new Error("另一个标签页正在操作此实例");
            await execute();
          },
        );
      } else await execute();
    } catch (error) {
      record({ message: messageOf(error), failed: true });
      if (version === generation.current) patch({ notice: messageOf(error) });
    } finally {
      busy.current = false;
      patch({ job: undefined });
    }
  }
  return { ...state, refresh, login, logout, operate };
}
export type ConsoleController = ReturnType<typeof useConsole>;
