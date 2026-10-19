import { describe, it, expect } from "vitest";
import { runOperation, OperationIO } from "../src/operations";
function mock(
  options: {
    sameIp?: boolean;
    staticIp?: boolean;
    state?: string;
    failStart?: boolean;
    failStop?: boolean;
  } = {},
) {
  let now = 0,
    state = options.state ?? "running",
    starts = 0,
    stops = 0;
  const io: OperationIO = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    progress: () => {},
    get: async () => ({
      name: "test",
      state: { name: state },
      isStaticIp: options.staticIp,
      publicIpAddress:
        state === "running"
          ? starts && !options.sameIp
            ? "2.2.2.2"
            : "1.1.1.1"
          : undefined,
    }),
    command: async (action) => {
      if (action === "stop") {
        stops++;
        if (options.failStop) throw Error("unavailable");
        state = "stopped";
      } else {
        starts++;
        if (options.failStart) throw Error("unavailable");
        state = "running";
      }
    },
  };
  return {
    io,
    get starts() {
      return starts;
    },
    get stops() {
      return stops;
    },
  };
}
describe("browser operation orchestration", () => {
  it("stops then starts and returns the changed IP", async () => {
    const m = mock();
    expect(await runOperation("rotate-ip", m.io)).toEqual({
      oldIp: "1.1.1.1",
      newIp: "2.2.2.2",
      message: "公网 IP 已更换",
    });
    expect(m.stops).toBe(1);
    expect(m.starts).toBe(1);
  });
  it("reports unchanged IP without another rotation", async () => {
    const m = mock({ sameIp: true });
    expect((await runOperation("rotate-ip", m.io)).message).toBe("IP 未变化");
    expect(m.stops).toBe(1);
  });
  it("refuses static IP before a mutation", async () => {
    const m = mock({ staticIp: true });
    await expect(runOperation("rotate-ip", m.io)).rejects.toThrow("静态");
    expect(m.stops).toBe(0);
  });
  it("refuses rotation while stopped", async () => {
    await expect(
      runOperation("rotate-ip", mock({ state: "stopped" }).io),
    ).rejects.toThrow("当前状态");
  });
  it("starts a stopped instance", async () => {
    expect(
      (await runOperation("start", mock({ state: "stopped" }).io)).message,
    ).toBe("实例已运行");
  });
  it("stops without restarting", async () => {
    const m = mock();
    await runOperation("stop", m.io);
    expect(m.starts).toBe(0);
  });
  it("bounds retry and recovery attempts for failed start", async () => {
    const m = mock({ failStart: true });
    await expect(runOperation("rotate-ip", m.io)).rejects.toThrow("手动开机");
    expect(m.starts).toBe(10);
  });
  it("handles ambiguous stop failure by reconciling state", async () => {
    const m = mock({ failStop: true });
    await expect(runOperation("rotate-ip", m.io)).rejects.toThrow("已恢复运行");
    expect(m.starts).toBe(0);
  });
  it("retries temporary failures", async () => {
    const m = mock();
    const command = m.io.command;
    let attempts = 0;
    m.io.command = async (a, r) => {
      if (attempts++ === 0) throw Error("503");
      return command(a, r);
    };
    await runOperation("rotate-ip", m.io);
    expect(m.starts).toBe(1);
  });
  it("times out without an unbounded loop", async () => {
    const m = mock();
    m.io.command = async () => {};
    await expect(runOperation("stop", m.io)).rejects.toThrow("超时");
    expect(m.io.now()).toBeLessThan(1000000);
  });
});

it.each([400, 401, 403, 404, 409, 422])(
  "does not retry permanent HTTP %s failures",
  async (status) => {
    const m = mock({ state: "stopped" });
    let calls = 0;
    m.io.command = async () => {
      calls++;
      throw Object.assign(new Error("permanent"), { status });
    };
    await expect(runOperation("start", m.io)).rejects.toThrow("permanent");
    expect(calls).toBe(1);
    expect(m.io.now()).toBe(0);
  },
);
it("does not retry commands after the operation deadline", async () => {
  const m = mock({ state: "stopped" });
  let calls = 0;
  const sleep = m.io.sleep;
  m.io.command = async () => {
    calls++;
    await sleep(15 * 60 * 1000 - 5000);
    throw new Error("temporary");
  };
  await expect(runOperation("start", m.io)).rejects.toThrow("超时");
  expect(calls).toBe(1);
  expect(m.io.now()).toBe(15 * 60 * 1000);
});
it("retries a temporary initial state read before sending commands", async () => {
  const m = mock({ state: "stopped" });
  const get = m.io.get;
  let reads = 0;
  m.io.get = async () => {
    if (++reads === 1) throw new Error("temporary");
    return get();
  };
  expect((await runOperation("start", m.io)).message).toBe("实例已运行");
  expect(m.starts).toBe(1);
  expect(m.io.now()).toBe(10_000);
});
it("stops polling and recovery when the session is aborted", async () => {
  const m = mock();
  const controller = new AbortController();
  m.io.signal = controller.signal;
  const command = m.io.command;
  m.io.command = async (action, rotate) => {
    await command(action, rotate);
    controller.abort(new Error("session ended"));
  };
  await expect(runOperation("rotate-ip", m.io)).rejects.toThrow(
    "session ended",
  );
  expect(m.stops).toBe(1);
  expect(m.starts).toBe(0);
});
