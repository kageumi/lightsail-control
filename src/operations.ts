import type { Instance, InstanceCommand } from "../worker/types";
import { messageOf } from "./api";

export type OperationAction = InstanceCommand | "rotate-ip";
export interface OperationIO {
  signal?: AbortSignal;
  get(): Promise<Instance>;
  command(action: InstanceCommand, rotate: boolean): Promise<void>;
  progress(message: string): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}
export interface OperationResult {
  oldIp?: string;
  newIp?: string;
  message: string;
}

export async function runOperation(
  action: OperationAction,
  io: OperationIO,
): Promise<OperationResult> {
  io.signal?.throwIfAborted();
  const deadline = io.now() + 15 * 60_000;
  const pause = (end: number) =>
    io.sleep(Math.min(10_000, Math.max(0, end - io.now())));
  const attempt = async <T>(
    task: () => Promise<T>,
    end = deadline,
  ): Promise<T> => {
    for (let failures = 0; ; failures++) {
      io.signal?.throwIfAborted();
      if (io.now() >= end) throw new Error("操作超时，请检查实例当前状态");
      try {
        return await task();
      } catch (error) {
        io.signal?.throwIfAborted();
        const status = (error as { status?: number } | null)?.status;
        if (
          failures >= 4 ||
          (status !== undefined && status < 500 && status !== 429)
        )
          throw error;
        await pause(end);
      }
    }
  };
  const initial = await attempt(io.get);
  io.signal?.throwIfAborted();
  if (action === "rotate-ip" && initial.isStaticIp)
    throw new Error("静态 IP 实例无法更换 IP");
  if (initial.state.name !== (action === "start" ? "stopped" : "running"))
    throw new Error("当前状态不允许此操作，请刷新");
  const oldIp = initial.publicIpAddress;
  const awaitState = async (
    target: string,
    end = deadline,
  ): Promise<Instance> => {
    while (io.now() < end) {
      const latest = await attempt(io.get, end);
      if (
        latest.state.name === target &&
        (target !== "running" || latest.publicIpAddress)
      )
        return latest;
      await pause(end);
    }
    throw new Error("操作超时，请检查实例当前状态");
  };
  let stopRequested = false;
  try {
    if (action !== "start") {
      io.progress("正在关机");
      stopRequested = true;
      await attempt(() => io.command("stop", action === "rotate-ip"));
      io.progress("等待实例停止");
      await awaitState("stopped");
      if (action === "stop") return { oldIp, message: "实例已停止" };
    }
    io.progress("正在开机");
    await attempt(() => io.command("start", false));
    io.progress("等待运行并获取公网 IP");
    const final = await awaitState("running");
    return {
      oldIp,
      newIp: final.publicIpAddress,
      message:
        action === "start"
          ? "实例已运行"
          : oldIp === final.publicIpAddress
            ? "IP 未变化"
            : "公网 IP 已更换",
    };
  } catch (error) {
    if (
      io.signal?.aborted ||
      action !== "rotate-ip" ||
      !stopRequested ||
      (error as { status?: number })?.status === 401
    )
      throw error;
    io.progress("操作异常，尝试恢复开机");
    try {
      const recoveryDeadline = io.now() + 5 * 60_000;
      let latest = await attempt(io.get, recoveryDeadline);
      if (latest.state.name === "stopping")
        latest = await awaitState("stopped", recoveryDeadline);
      if (latest.state.name === "stopped")
        await attempt(() => io.command("start", false), recoveryDeadline);
      await awaitState("running", recoveryDeadline);
    } catch (recovery) {
      throw new Error("操作失败且无法确认恢复开机，请刷新状态并手动开机", {
        cause: recovery,
      });
    }
    throw new Error(`换 IP 未完成；实例已恢复运行。${messageOf(error)}`, {
      cause: error,
    });
  }
}
