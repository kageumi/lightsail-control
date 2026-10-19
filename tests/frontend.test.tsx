// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../src/hooks/use-theme";
import App from "../src/app";
import { runOperation } from "../src/operations";
import type { Instance } from "../worker/types";
vi.mock("../src/operations", () => ({ runOperation: vi.fn() }));
let authenticated: boolean;
let row: Instance;
let error: string | undefined;
let count: number;
let subscriptionError: boolean;
let unauthorized: boolean;
let calls: { path: string; body?: unknown }[];
function mount() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}
async function dashboard() {
  mount();
  await screen.findByRole("heading", { name: "Debian-1" });
}
const button = (name: string) =>
  screen.getByRole<HTMLButtonElement>("button", { name });
async function confirmRotate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(button("更换 IP"));
  await user.click(await screen.findByRole("button", { name: "确认更换 IP" }));
}
beforeEach(() => {
  authenticated = true;
  count = 1;
  error = undefined;
  subscriptionError = false;
  unauthorized = false;
  calls = [];
  row = {
    name: "Debian-1",
    state: { name: "running" },
    publicIpAddress: "203.0.113.24",
    isStaticIp: false,
    blueprintName: "Debian 12",
    hardware: {
      cpuCount: 2,
      ramSizeInGb: 0.5,
      disks: [{ sizeInGb: 20, isSystemDisk: true }],
    },
    username: "admin",
  };
  window.history.replaceState(null, "", "/");
  const memory = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
    clear: () => memory.clear(),
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  });
  window.scrollTo = vi.fn();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
  vi.mocked(runOperation).mockReset().mockResolvedValue({
    message: "公网 IP 已更换",
    oldIp: "203.0.113.24",
    newIp: "203.0.113.85",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      const path = String(url).replace("/api/", "");
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ path, body });
      if (path === "session") return Response.json({ authenticated });
      if (path === "login") {
        authenticated = true;
        return Response.json({ ok: true });
      }
      if (path === "logout") {
        authenticated = false;
        return Response.json({ ok: true });
      }
      if (unauthorized)
        return Response.json({ error: "登录失效" }, { status: 401 });
      if (path === "instances")
        return Response.json({
          regions: [
            {
              region: "ap-southeast-1",
              instances: Array.from({ length: count }, (_, i) => ({
                ...row,
                name: i ? "Debian-2" : row.name,
              })),
              error,
            },
          ],
        });
      if (path === "sub")
        return subscriptionError
          ? Response.json({ error: "订阅不可用" }, { status: 422 })
          : Response.json({ ok: true });
      return Response.json(row);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("rebuilt shadcn console", () => {
  it("persists theme changes and restores them on remount", async () => {
    const user = userEvent.setup();
    await dashboard();
    await user.click(button("切换明暗主题"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("lightsail-theme")).toBe("dark");
    cleanup();
    await dashboard();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
  it("copies the actual public address", async () => {
    const user = userEvent.setup();
    await dashboard();
    await user.click(button("复制 IP"));
    expect(await navigator.clipboard.readText()).toBe("203.0.113.24");
  });
  it("confirms stop and logs out without retaining the instance", async () => {
    vi.mocked(runOperation).mockResolvedValue({ message: "实例已停止" });
    const user = userEvent.setup();
    await dashboard();
    await user.click(button("关机"));
    await user.click(button("确认关机"));
    await screen.findAllByText("实例已停止");
    expect(runOperation).toHaveBeenCalledWith("stop", expect.any(Object));
    await user.click(button("退出登录"));
    await screen.findByLabelText("管理密码");
    expect(screen.queryByText("Debian-1")).toBeNull();
  });

  it("submits login with Enter once, and can reveal the password", async () => {
    authenticated = false;
    const user = userEvent.setup();
    mount();
    const input = await screen.findByLabelText<HTMLInputElement>("管理密码");
    await user.type(input, "test-password");
    await user.click(button("显示密码"));
    expect(input.type).toBe("text");
    await user.click(button("隐藏密码"));
    expect(input.type).toBe("password");
    await user.type(input, "{Enter}");
    await screen.findByRole("heading", { name: "Debian-1" });
    expect(calls.filter((item) => item.path === "login")).toEqual([
      { path: "login", body: { password: "test-password" } },
    ]);
  });
  it("rejects a short password before sending credentials", async () => {
    authenticated = false;
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText("管理密码"), "short");
    await user.click(button("进入控制台"));
    expect(screen.getByText("密码至少 8 位")).toBeTruthy();
    expect(calls.some((item) => item.path === "login")).toBe(false);
  });
  it("shows actual configuration and only the first returned instance", async () => {
    count = 2;
    await dashboard();
    expect(screen.queryByText("Debian-2")).toBeNull();
    expect(screen.getByText("203.0.113.24")).toBeTruthy();
    expect(screen.getByText("Debian 12")).toBeTruthy();
    expect(button("更换 IP").disabled).toBe(false);
  });
  it("does not mutate the instance when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    await dashboard();
    await user.click(button("关机"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await user.click(button("取消"));
    expect(runOperation).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
  it("locks controls during rotation, protects navigation and syncs the new IP", async () => {
    let finish!: (value: {
      message: string;
      oldIp: string;
      newIp: string;
    }) => void;
    vi.mocked(runOperation).mockImplementation(async (_, io) => {
      io.progress("等待实例停止");
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const user = userEvent.setup();
    await dashboard();
    await confirmRotate(user);
    await screen.findByText("等待实例停止");
    for (const label of ["更换 IP", "关机", "刷新状态", "退出登录"])
      expect(button(label).disabled).toBe(true);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    act(() =>
      finish({
        message: "公网 IP 已更换",
        oldIp: "203.0.113.24",
        newIp: "203.0.113.85",
      }),
    );
    await screen.findAllByText("公网 IP 已更换");
    expect(calls.find((item) => item.path === "sub")?.body).toEqual({
      ip: "203.0.113.85",
    });
    expect(runOperation).toHaveBeenCalledOnce();
    await waitFor(() => expect(button("更换 IP").disabled).toBe(false));
  });
  it("preserves a successful rotation when subscription sync fails", async () => {
    subscriptionError = true;
    const user = userEvent.setup();
    await dashboard();
    await confirmRotate(user);
    await screen.findByText("订阅同步未全部完成：订阅不可用");
    expect(screen.getAllByText("公网 IP 已更换").length).toBeGreaterThan(0);
  });
  it("refuses duplicate operations across tabs", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: vi.fn(async (_key, _options, callback) => callback(null)),
      },
    });
    const user = userEvent.setup();
    await dashboard();
    await confirmRotate(user);
    await screen.findAllByText("另一个标签页正在操作此实例");
    expect(runOperation).not.toHaveBeenCalled();
    expect(button("更换 IP").disabled).toBe(false);
  });
  it("releases controls after a failed operation", async () => {
    vi.mocked(runOperation).mockRejectedValue(new Error("操作失败，请重试"));
    const user = userEvent.setup();
    await dashboard();
    await confirmRotate(user);
    await screen.findAllByText("操作失败，请重试");
    expect(button("更换 IP").disabled).toBe(false);
  });
  it("protects static IP and provides start for stopped instances", async () => {
    row.isStaticIp = true;
    await dashboard();
    expect(button("更换 IP").disabled).toBe(true);
    cleanup();
    row.state.name = "stopped";
    row.publicIpAddress = undefined;
    await dashboard();
    expect(button("开机").disabled).toBe(false);
    expect(button("复制 IP").disabled).toBe(true);
  });
  it("keeps absent hardware and addresses honest", async () => {
    row = { name: "Minimal", state: { name: "stopped" } };
    mount();
    await screen.findByRole("heading", { name: "Minimal" });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(button("复制 IP").disabled).toBe(true);
    expect(screen.queryByText("0 GB")).toBeNull();
    expect(button("开机").disabled).toBe(false);
  });
  it("shows no controls for empty or unreadable results and supports retry", async () => {
    count = 0;
    mount();
    await screen.findByText("没有可控制的实例");
    expect(screen.queryByRole("button", { name: "更换 IP" })).toBeNull();
    count = 1;
    const user = userEvent.setup();
    await user.click(button("重试"));
    await screen.findByRole("heading", { name: "Debian-1" });
    cleanup();
    error = "读取实例失败";
    mount();
    await screen.findByText("读取实例失败");
    expect(screen.queryByRole("button", { name: "关机" })).toBeNull();
  });
  it("shows configuration, connection and history together without navigation", async () => {
    window.history.replaceState(null, "", "/#server-info");
    await dashboard();
    expect(screen.getByText("Debian 12")).toBeTruthy();
    expect(screen.getByText("ssh admin@203.0.113.24")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "操作记录" })).toBeTruthy();
    expect(screen.getByText("暂无操作记录")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    const user = userEvent.setup();
    await user.click(button("复制 SSH 命令"));
    expect(await navigator.clipboard.readText()).toBe("ssh admin@203.0.113.24");
  });
  it("redirects an expired session to login without retaining instance data", async () => {
    const user = userEvent.setup();
    await dashboard();
    unauthorized = true;
    await user.click(button("刷新状态"));
    await screen.findByLabelText("管理密码");
    expect(screen.queryByText("Debian-1")).toBeNull();
    expect(screen.getByText("登录已过期，请重新登录")).toBeTruthy();
  });
  it("shows successful and failed activity on the same page", async () => {
    const user = userEvent.setup();
    await dashboard();
    await confirmRotate(user);
    await screen.findAllByText("公网 IP 已更换");
    expect(within(screen.getByRole("table")).getByText("完成")).toBeTruthy();
    vi.mocked(runOperation).mockRejectedValue(new Error("操作失败，请重试"));
    await confirmRotate(user);
    await screen.findAllByText("操作失败，请重试");
    const history = within(screen.getByRole("table"));
    expect(history.getByText("完成")).toBeTruthy();
    expect(history.getByText("失败")).toBeTruthy();
    expect(history.getAllByRole("row")).toHaveLength(3);
  });
  it("refreshes the selected instance without scanning every region again", async () => {
    const user = userEvent.setup();
    await dashboard();
    row.state.name = "stopped";
    row.publicIpAddress = undefined;
    await user.click(button("刷新状态"));
    await screen.findByRole("button", { name: "开机" });
    expect(calls.filter((item) => item.path === "instances")).toHaveLength(1);
    expect(
      calls.filter((item) => item.path.startsWith("instance?")),
    ).toHaveLength(1);
    expect(button("复制 IP").disabled).toBe(true);
  });
  it("keeps the last instance visible and locks operations until a failed refresh recovers", async () => {
    const user = userEvent.setup();
    await dashboard();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "暂时无法连接 AWS" }, { status: 503 }),
    );
    await user.click(button("刷新状态"));
    await screen.findByText("暂时无法连接 AWS");
    expect(screen.getByRole("heading", { name: "Debian-1" })).toBeTruthy();
    expect(button("更换 IP").disabled).toBe(true);
    expect(button("关机").disabled).toBe(true);
    vi.mocked(fetch).mockImplementation(original);
    await user.click(button("刷新状态"));
    await waitFor(() => expect(button("更换 IP").disabled).toBe(false));
    expect(screen.queryByText("暂时无法连接 AWS")).toBeNull();
  });
  it("discovers a replacement after the selected instance no longer exists", async () => {
    const user = userEvent.setup();
    await dashboard();
    row.name = "Replacement";
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "实例不存在" }, { status: 404 }),
    );
    await user.click(button("刷新状态"));
    await screen.findByRole("heading", { name: "Replacement" });
    expect(calls.filter((item) => item.path === "instances")).toHaveLength(2);
  });
  it("rejects malformed refresh data without crashing or exposing controls", async () => {
    const user = userEvent.setup();
    await dashboard();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: true }));
    await user.click(button("刷新状态"));
    await screen.findByText("服务器实例响应格式不正确，请重试");
    expect(button("更换 IP").disabled).toBe(true);
    expect(screen.getByRole("heading", { name: "Debian-1" })).toBeTruthy();
  });
  it("cancels in-flight reads when the console is unmounted", async () => {
    const user = userEvent.setup();
    await dashboard();
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce(async (_input, options) => {
      signal = options?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason), {
          once: true,
        });
      });
    });
    await user.click(button("刷新状态"));
    expect(signal?.aborted).toBe(false);
    cleanup();
    expect(signal?.aborted).toBe(true);
  });
  it("leaves the session loader when authentication expires during initial discovery", async () => {
    unauthorized = true;
    mount();
    await screen.findByLabelText("管理密码");
    expect(screen.getByText("登录已过期，请重新登录")).toBeTruthy();
    expect(screen.queryByText("加载中")).toBeNull();
  });
});
