import type { Instance } from "../worker/types";
export type Row = Instance & { region: string };
export interface InstanceResponse {
  regions: { region: string; instances: Instance[]; error?: string }[];
}
export function instanceRow(instance: Instance, region: string): Row {
  if (
    !instance ||
    typeof instance.name !== "string" ||
    typeof instance.state?.name !== "string"
  )
    throw new Error("服务器实例响应格式不正确，请重试");
  return { ...instance, region };
}
export function selectFirstInstance(response: InstanceResponse): Row {
  if (
    !Array.isArray(response?.regions) ||
    response.regions.some(
      (item) =>
        !item ||
        typeof item.region !== "string" ||
        !Array.isArray(item.instances),
    )
  )
    throw new Error("服务器实例响应格式不正确，请重试");
  const available = response.regions.find(
    (item) => !item.error && item.instances.length > 0,
  );
  if (available) return instanceRow(available.instances[0], available.region);
  throw new Error(
    response.regions.find((item) => item.error)?.error ||
      "没有找到实例，请检查服务器和 AWS 权限。",
  );
}
